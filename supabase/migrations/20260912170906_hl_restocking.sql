-- Restocking has its own intent identity. No synthetic SOC rows are created.
begin;
alter table hl_order_private.dispositions add column source_kind text not null default 'soc';
alter table hl_order_private.drafts add column source_kind text not null default 'soc';
alter table hl_order_private.order_lines add column source_kind text not null default 'soc';
alter table hl_order_private.dispositions add check(source_kind in ('soc','restock'));
alter table hl_order_private.drafts add check(source_kind in ('soc','restock'));
alter table hl_order_private.order_lines add check(source_kind in ('soc','restock'));
alter table hl_order_private.dispositions add check(source_kind=coalesce(source->>'source_kind','soc'));
alter table hl_order_private.drafts add check(source_kind=coalesce(source->>'source_kind','soc'));
alter table hl_order_private.order_lines add check(source_kind=coalesce(source->>'source_kind','soc'));
create table hl_order_private.restock_intents (
  source_id text primary key, itemcode text not null, size text not null,
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
  check(source_id like 'restock:%'), check(itemcode<>'' and size<>'')
);
create table hl_order_private.restock_inventory_gates (
  itemcode text not null, size text not null, receipt_watermark bigint not null,
  receipt_revision bigint not null, receipt_at timestamptz not null,
  confirmed_watermark bigint not null default 0, confirmed_snapshot jsonb, confirmed_by uuid,
  confirmed_at timestamptz, primary key(itemcode,size)
);
create index hl_restock_intent_item on hl_order_private.restock_intents(itemcode,size);
alter table hl_order_private.restock_intents enable row level security;
alter table hl_order_private.restock_inventory_gates enable row level security;
revoke all on hl_order_private.restock_intents,hl_order_private.restock_inventory_gates from public,anon,authenticated,service_role;
create trigger hl_restock_intents_immutable before update or delete on hl_order_private.restock_intents
  for each row execute function hl_order_private.protect_history();

create function hl_order_private.restock_snapshot() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('master_revision',r.revision::text,'changed_at',r.changed_at,'state',r.state,
    'po_scope',c.active_scope,'po_revision',(select revision::text from public.app_dataset_revisions where key='ph_27f1_hl_po'),
    'actor_role',(select role from public.profiles where id=auth.uid()))
  from public.app_dataset_revisions r cross join hl_order_private.po_control c where r.key='ph_master_inventory'
$$;

create function hl_order_private.restock_receipt_gate() returns trigger
language plpgsql security definer set search_path='' as $$
declare s jsonb; code text; sz text;
begin
  perform 1 from hl_order_private.state where singleton for update;
  select source into s from hl_order_private.order_lines where id=new.line_id;
  if s->>'source_kind' is distinct from 'restock' then return new; end if;
  code:=upper(btrim(s->>'itemcode')); sz:=upper(btrim(s->>'contsize'));
  insert into hl_order_private.restock_inventory_gates(itemcode,size,receipt_watermark,receipt_revision,receipt_at)
    values(code,sz,1,coalesce((select revision from public.app_dataset_revisions where key='ph_master_inventory'),0),new.created_at)
    on conflict(itemcode,size) do update set receipt_watermark=restock_inventory_gates.receipt_watermark+1,
      receipt_revision=excluded.receipt_revision,receipt_at=excluded.receipt_at;
  return new;
end $$;
create trigger hl_restock_receipt_gate after insert on hl_order_private.receipts
  for each row execute function hl_order_private.restock_receipt_gate();
-- Only restock receipts affect this confirmation gate; all HL receipts retain
-- their existing independent PO balance ledger adjustment.
insert into hl_order_private.restock_inventory_gates(itemcode,size,receipt_watermark,receipt_revision,receipt_at)
  select a.itemcode,a.size,count(*),coalesce((select revision from public.app_dataset_revisions where key='ph_master_inventory'),0),max(a.created_at)
  from hl_order_private.po_receipt_adjustments a join hl_order_private.receipts r on r.id=a.receipt_id
  join hl_order_private.order_lines l on l.id=r.line_id where l.source_kind='restock' group by a.itemcode,a.size;

create function hl_order_private.restock_items() returns setof jsonb
language sql stable security definer set search_path='' as $$
  with po as materialized (
    select upper(btrim(p.item_code)) itemcode,upper(btrim(p.size)) size,min(p.common_name) commonname,
      case when count(distinct p.po_ordered)=1 and count(*) filter(where p.po_ordered is null or p.po_ordered<0 or p.po_ordered::text in ('NaN','Infinity','-Infinity'))=0 then min(p.po_ordered) end po_ordered
    from public.ph_27f1_hl_po p join hl_order_private.po_control c on coalesce(nullif(p.run_id,''),p.source_file_id)=c.active_scope
    where upper(btrim(p.lot))='27.F1' and nullif(btrim(p.item_code),'') is not null and nullif(btrim(p.size),'') is not null group by 1,2
  ), balances as materialized (select * from hl_order_private.po_balances()), master_ids as materialized (
    select upper(btrim(m.itemcode)) itemcode,upper(btrim(m.contsize)) size,m.unique_id,
      case when nullif(btrim(m.unique_id),'') is not null and count(distinct hl_order_private.quantity(m.ptravailable::text))=1
        and bool_and(hl_order_private.quantity(m.ptravailable::text) is not null) then min(hl_order_private.quantity(m.ptravailable::text)) end available
    from public.ph_master_inventory m join po p on p.itemcode=upper(btrim(m.itemcode)) and p.size=upper(btrim(m.contsize))
    where upper(btrim(m.lotcode))='27.F1' and lower(btrim(coalesce(m.app_tab_assignment,''))) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
      and (not exists(select 1 from public.profiles p where p.id=auth.uid() and upper(p.role) like '%FOREMAN%')
        or upper(btrim(coalesce(m.priority,''))) not in ('','-','--','---','N/A','NA','NULL','NONE'))
    group by 1,2,m.unique_id
  ), master as (
    select itemcode,size,case when bool_and(available is not null) then sum(available) end available from master_ids group by 1,2
  ), saved as (
    select i.itemcode,i.size,sum(d.quantity) quantity,min(d.source_id) source_id from hl_order_private.drafts d
    join hl_order_private.restock_intents i using(source_id) join hl_order_private.dispositions x using(source_id)
    where x.status='draft' group by 1,2
  ), incoming as (
    select i.itemcode,i.size,sum(l.quantity-l.received_quantity-l.cancelled_quantity) quantity
    from hl_order_private.order_lines l join hl_order_private.restock_intents i using(source_id) group by 1,2
  ), receipt_review as (
    select i.itemcode,i.size,jsonb_agg(jsonb_build_object('id',r.id,'order_number',o.order_number,
      'received_quantity',r.received_quantity,'previous_quantity',r.previous_quantity,'quantity_delta',r.quantity_delta,'created_at',r.created_at)
      order by r.created_at,r.id) receipts
    from hl_order_private.receipts r join hl_order_private.order_lines l on l.id=r.line_id
    join hl_order_private.restock_intents i on i.source_id=l.source_id join hl_order_private.orders o on o.id=r.order_id
    left join hl_order_private.restock_inventory_gates g on g.itemcode=i.itemcode and g.size=i.size
    where g.confirmed_at is null or r.created_at>g.confirmed_at group by i.itemcode,i.size
  ), amounts as (
    select p.*,ceil(p.po_ordered*0.30) target,case when m.itemcode is null then 0 else m.available end available,coalesce(s.quantity,0) saved_quantity,s.source_id,
      coalesce(n.quantity,0) incoming_quantity,coalesce(g.receipt_watermark,0) receipt_watermark,
      coalesce(rr.receipts,'[]'::jsonb) receipts,snap->>'changed_at' inventory_updated_at,
      case when snap->>'state' is distinct from 'ready' then 'inventory_verifying'
        when p.po_ordered is null then 'po_unknown' when m.itemcode is not null and m.available is null then 'inventory_unknown'
        when g.receipt_watermark>g.confirmed_watermark then 'receipt_pending' else 'ready' end status,
      coalesce(g.receipt_watermark>g.confirmed_watermark and (snap->>'master_revision')::bigint>g.receipt_revision
        and (snap->>'changed_at')::timestamptz>g.receipt_at and snap->>'state'='ready' and (m.itemcode is null or m.available is not null),false) can_confirm_inventory
    from po p left join master m using(itemcode,size) left join saved s using(itemcode,size)
    left join incoming n using(itemcode,size) left join hl_order_private.restock_inventory_gates g using(itemcode,size)
    left join receipt_review rr using(itemcode,size)
    cross join lateral(select hl_order_private.restock_snapshot() snap) snapshot
  ) select to_jsonb(a)||jsonb_build_object('suggested_quantity',case when a.status='ready' then greatest(0,ceil(target-available-saved_quantity-incoming_quantity)) end,
    'po_balance',to_jsonb(b)||jsonb_build_object('lot','27.F1')) from amounts a left join balances b using(itemcode,size) order by itemcode,size
$$;

create function public.hl_order_restock_state() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform hl_order_private.assert_dylan();
  if app_sync_private.can_read_source('ph_master_inventory') is distinct from true then
    raise exception using errcode='42501',message='HL_RESTOCK_INVENTORY_FORBIDDEN'; end if;
  perform 1 from hl_order_private.state where singleton for update;
  lock table public.ph_master_inventory in share mode;
  perform 1 from public.app_dataset_revisions where key='ph_master_inventory' for share;
  return jsonb_build_object('revision',(select revision from hl_order_private.state where singleton),
    'inventory_snapshot',hl_order_private.restock_snapshot(),'items',coalesce((select jsonb_agg(i) from hl_order_private.restock_items() i),'[]'));
end $$;

create function hl_order_private.validate_restock_drafts(p_date date) returns void
language plpgsql security definer set search_path='' as $$
declare d record; item jsonb; items jsonb; snap jsonb:=hl_order_private.restock_snapshot();
begin
  if not exists(select 1 from hl_order_private.drafts q join hl_order_private.dispositions x using(source_id)
    where q.source_kind='restock' and x.status='draft' and q.ship_date=p_date) then return; end if;
  if app_sync_private.can_read_source('ph_master_inventory') is distinct from true then
    raise exception using errcode='42501',message='HL_RESTOCK_INVENTORY_FORBIDDEN'; end if;
  select jsonb_agg(i) into items from hl_order_private.restock_items() i;
  for d in select q.* from hl_order_private.drafts q join hl_order_private.dispositions x using(source_id)
    where q.source_kind='restock' and x.status='draft' and q.ship_date=p_date loop
    select i into item from jsonb_array_elements(items) i where i->>'itemcode'=d.source->>'itemcode' and i->>'size'=d.source->>'contsize';
    if item is null or item->>'status'<>'ready' or d.source->'inventory_snapshot' is distinct from snap
      or (item->>'saved_quantity')::numeric>greatest(0,ceil((item->>'target')::numeric-(item->>'available')::numeric-(item->>'incoming_quantity')::numeric)) then
      raise exception using errcode='55000',message='HL_RESTOCK_REVIEW_REQUIRED';
    end if;
  end loop;
end $$;

alter function hl_order_private.state_json() rename to state_json_before_restock;
create function hl_order_private.state_json() returns jsonb
language sql stable security definer set search_path='' as $$
  select s||jsonb_build_object('draft',coalesce((select jsonb_agg(d||jsonb_build_object('source_kind',coalesce(d->'source'->>'source_kind','soc'))) from jsonb_array_elements(s->'draft') d),'[]'))
  from (select hl_order_private.state_json_before_restock() s) q
$$;

alter function public.hl_order_command(uuid,text,jsonb,bigint) set schema hl_order_private;
alter function hl_order_private.hl_order_command(uuid,text,jsonb,bigint) rename to command_before_restock;
create function public.hl_order_command(p_command_id uuid,p_action text,p_payload jsonb,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=hl_order_private.assert_dylan(); rev bigint; request_hash text; saved hl_order_private.commands;
  snap jsonb; item jsonb; items jsonb; entry jsonb; source_value jsonb; source_id_value text; code text; sz text; qty numeric; prior_qty numeric;
  day date; gate hl_order_private.restock_inventory_gates; result jsonb; seen text[]:='{}';
begin
  if p_command_id is null or p_expected_revision is null or p_expected_revision<0 or octet_length(coalesce(p_payload::text,''))>200000 then
    raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
  request_hash:=hl_order_private.fingerprint(jsonb_build_array(p_action,p_payload,p_expected_revision));
  select revision into rev from hl_order_private.state where singleton for update;
  select * into saved from hl_order_private.commands where command_id=p_command_id;
  if found then
    if saved.created_by<>actor or saved.request_hash<>request_hash then raise exception using errcode='22023',message='HL_ORDER_COMMAND_ID_CONFLICT'; end if;
    return saved.response;
  end if;
  if p_action in ('restock_draft_save','restock_inventory_confirm','preview','submit') then
    lock table public.ph_master_inventory in share mode;
    perform 1 from public.app_dataset_revisions where key='ph_master_inventory' for share;
    snap:=hl_order_private.restock_snapshot();
  end if;
  if p_action not in ('restock_draft_save','restock_inventory_confirm') or p_action is null then
    if p_action='preview' then
      if p_payload ? 'ship_date' then day:=hl_order_private.ship_date(p_payload->>'ship_date');
      else select min(ship_date) into day from hl_order_private.drafts; end if;
      perform hl_order_private.validate_restock_drafts(day);
    elsif p_action='submit' then
      select hl_order_private.ship_date(report->>'ship_date') into day from public.ph_hl_order_previews where id=(p_payload->>'preview_id')::uuid;
      perform hl_order_private.validate_restock_drafts(day);
    end if;
    return hl_order_private.command_before_restock(p_command_id,p_action,p_payload,p_expected_revision);
  end if;
  perform hl_order_private.assert_keys(p_payload,case when p_action='restock_draft_save' then array['ship_date','rows','inventory_snapshot'] else array['itemcode','size','inventory_snapshot','receipt_watermark'] end);
  if app_sync_private.can_read_source('ph_master_inventory') is distinct from true then
    raise exception using errcode='42501',message='HL_RESTOCK_INVENTORY_FORBIDDEN'; end if;
  if rev<>p_expected_revision then raise exception using errcode='40001',message='HL_ORDER_REVISION_CONFLICT'; end if;
  if snap is null or snap->>'state'<>'ready' or p_payload->'inventory_snapshot' is distinct from snap then
    raise exception using errcode='55000',message='HL_RESTOCK_INVENTORY_STALE'; end if;
  select jsonb_agg(i) into items from hl_order_private.restock_items() i;
  if p_action='restock_inventory_confirm' then
    code:=upper(btrim(p_payload->>'itemcode')); sz:=upper(btrim(p_payload->>'size'));
    select * into gate from hl_order_private.restock_inventory_gates where itemcode=code and size=sz for update;
    select i into item from jsonb_array_elements(items) i where i->>'itemcode'=code and i->>'size'=sz;
    if gate.receipt_watermark is null or p_payload->>'receipt_watermark' is distinct from gate.receipt_watermark::text
      or coalesce((item->>'can_confirm_inventory')::boolean,false) is false then
      raise exception using errcode='55000',message='HL_RESTOCK_CONFIRMATION_STALE'; end if;
    update hl_order_private.restock_inventory_gates set confirmed_watermark=receipt_watermark,confirmed_snapshot=snap,
      confirmed_by=actor,confirmed_at=clock_timestamp() where itemcode=code and size=sz;
  else
    day:=hl_order_private.ship_date(p_payload->>'ship_date');
    if day is null or coalesce(p_payload->>'ship_date','') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception using errcode='22023',message='HL_ORDER_SHIP_DATE_REQUIRED'; end if;
    if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 500 then
      raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
    for entry in select value from jsonb_array_elements(p_payload->'rows') loop
      perform hl_order_private.assert_keys(entry,array['itemcode','size','quantity','source_id']);
      code:=upper(btrim(entry->>'itemcode')); sz:=upper(btrim(entry->>'size')); qty:=hl_order_private.quantity(entry->>'quantity');
      if qty is null or qty<=0 or qty<>trunc(qty) or qty>1000000000 then
        raise exception using errcode='22023',message='HL_ORDER_INVALID_QUANTITY'; end if;
      if code is null or sz is null or code='' or sz='' or jsonb_build_array(code,sz)::text=any(seen) then
        raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
      seen:=array_append(seen,jsonb_build_array(code,sz)::text);
      select i into item from jsonb_array_elements(items) i where i->>'itemcode'=code and i->>'size'=sz;
      if item is null or item->>'status'<>'ready' then raise exception using errcode='55000',message='HL_RESTOCK_REVIEW_REQUIRED'; end if;
      source_id_value:=nullif(entry->>'source_id','');
      if source_id_value is null then
        select d.source_id into source_id_value from hl_order_private.drafts d join hl_order_private.restock_intents i using(source_id)
          join hl_order_private.dispositions x using(source_id) where i.itemcode=code and i.size=sz and d.ship_date=day and x.status='draft' order by d.source_id limit 1;
      elsif not exists(select 1 from hl_order_private.restock_intents i join hl_order_private.drafts d using(source_id)
        join hl_order_private.dispositions x using(source_id) where i.source_id=source_id_value and i.itemcode=code and i.size=sz and x.status='draft') then
        raise exception using errcode='55000',message='HL_RESTOCK_REVIEW_REQUIRED';
      end if;
      select quantity into prior_qty from hl_order_private.drafts where source_id=source_id_value;
      -- New selections add to this date's draft. Explicit saved-row edits
      -- replace only that intent and receive credit for its prior reservation.
      if nullif(entry->>'source_id','') is null then qty:=qty+coalesce(prior_qty,0); end if;
      if qty is null or qty<=0 or qty<>trunc(qty) or qty>1000000000
        or qty>greatest(0,ceil((item->>'target')::numeric-(item->>'available')::numeric-(item->>'incoming_quantity')::numeric-(item->>'saved_quantity')::numeric+coalesce(prior_qty,0))) then
        raise exception using errcode='22023',message='HL_ORDER_INVALID_QUANTITY'; end if;
      if source_id_value is null then
        source_id_value:='restock:'||gen_random_uuid()::text;
        insert into hl_order_private.restock_intents(source_id,itemcode,size,created_by) values(source_id_value,code,sz,actor);
      end if;
      perform hl_order_private.assert_source_unlocked(source_id_value);
      source_value:=jsonb_build_object('source_kind','restock','source_id',source_id_value,'unique_id',source_id_value,
        'itemcode',code,'contsize',sz,'commonname',item->>'commonname','planstartdate',day,'lotcode','27.F1','locationcode','',
        'dock','','stopnumber','','transactionnumber','','purchaseordernumber','','tripnumber','','customeridentityid','','customername','',
        'consigneeidentityid','','consigneename','','invoicedate','','quantityordered',(item->>'target')::numeric,
        'ptravailable',(item->>'available')::numeric,'inventory_snapshot',snap,'restock_target',(item->>'target')::numeric,
        'receipt_watermark',(item->>'receipt_watermark')::bigint);
      source_value:=source_value||jsonb_build_object('source_fingerprint',hl_order_private.fingerprint(source_value));
      insert into hl_order_private.dispositions(source_id,status,source,observed_fingerprint,available_quantity,source_kind)
        values(source_id_value,'draft',source_value,source_value->>'source_fingerprint',(item->>'target')::numeric,'restock')
        on conflict(source_id) do update set source=excluded.source,observed_fingerprint=excluded.observed_fingerprint,available_quantity=excluded.available_quantity,updated_at=clock_timestamp();
      insert into hl_order_private.drafts(source_id,quantity,source,ship_date,target_order_id,source_kind)
        values(source_id_value,qty,source_value,day,hl_order_private.active_order(day),'restock') on conflict(source_id) do update set
          quantity=excluded.quantity,source=excluded.source,ship_date=excluded.ship_date,target_order_id=excluded.target_order_id,updated_at=clock_timestamp();
    end loop;
  end if;
  update hl_order_private.state set revision=revision+1 where singleton;
  insert into hl_order_private.history(command_id,action,payload,created_by) values(p_command_id,p_action,p_payload,actor);
  result:=hl_order_private.state_json();
  insert into hl_order_private.commands(command_id,created_by,request_hash,response) values(p_command_id,actor,request_hash,result);
  return result;
end $$;

-- Existing SOC gates remain intact; only intent classification and report version extend.
create or replace function hl_order_private.reconcile() returns boolean
language plpgsql security definer set search_path='' as $$
declare changed boolean:=false; count_changed integer;
begin
  with current_rows as materialized(select * from hl_order_private.sources())
  update hl_order_private.dispositions d set status='needs_review',
    reason=case when c.source is null then 'Source disappeared or is no longer eligible' else 'Source fields or quantity changed' end,
    review_kind=case when c.source is null then 'source_missing' else 'source_changed' end,
    observed_fingerprint=coalesce(c.source->>'source_fingerprint','missing'),updated_at=now()
  from (select old.source_id,cur.source from hl_order_private.dispositions old left join current_rows cur using(source_id)) c
  where d.source_kind='soc' and d.source_id=c.source_id and d.observed_fingerprint is distinct from coalesce(c.source->>'source_fingerprint','missing');
  get diagnostics count_changed=row_count; changed:=count_changed>0;

  -- A replacement ID matching previous order/customer/item/size is quarantined,
  -- never silently shown as fresh work alongside a handled imported row.
  with candidates as (
    select distinct on (s.source_id) s.source_id,s.source,d.source_id prior_source_id
    from hl_order_private.sources() s join hl_order_private.dispositions d
      on hl_order_private.business_key(s.source)=hl_order_private.business_key(d.source)
    where d.source_kind='soc' and s.source_id<>d.source_id and d.observed_fingerprint='missing'
      and not exists(select 1 from hl_order_private.dispositions x where x.source_id=s.source_id)
    order by s.source_id,d.source_id
  ) insert into hl_order_private.dispositions(source_id,status,source,observed_fingerprint,available_quantity,reason,review_kind)
    select source_id,'needs_review',source,source->>'source_fingerprint',coalesce(hl_order_private.quantity(source->>'quantityordered'),0),
      'Possible replacement for '||prior_source_id,'possible_replacement' from candidates;
  get diagnostics count_changed=row_count; changed:=changed or count_changed>0;
  if changed then update hl_order_private.state set revision=revision+1 where singleton; end if;
  return changed;
end $$;

alter function hl_order_private.report_source(jsonb) rename to report_source_before_restock;
create function hl_order_private.report_source(p_source jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p_source->>'source_kind'='restock' then p_source else hl_order_private.report_source_before_restock(p_source) end
$$;
create or replace function hl_order_private.command_before_po(p_command_id uuid,p_action text,p_payload jsonb,p_expected_revision bigint default null) returns jsonb
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
      if p_action='draft_clear' and disposition.source_kind='restock' then source_row:=disposition.source; end if;
      if source_row is null or disposition.status='needs_review'
        or (p_action='restore' and (disposition.status is distinct from 'removed' or disposition.replacement_source_id is not null))
        or (p_action='draft_clear' and disposition.status is distinct from 'draft')
        or (p_action='dismiss' and disposition.status is not null and disposition.status not in ('needed','draft')) then
        raise exception using errcode='55000',message='HL_ORDER_SOURCE_REVIEW_REQUIRED';
      end if;
      ceiling:=coalesce(disposition.available_quantity,hl_order_private.quantity(source_row->>'quantityordered'),0);
      insert into hl_order_private.dispositions(source_id,status,source,observed_fingerprint,available_quantity,reason,source_kind)
        values(source_id_value,case when p_action='dismiss' then 'removed' else 'needed' end,source_row,source_row->>'source_fingerprint',ceiling,
          case when p_action='dismiss' then 'Removed by Dylan' else '' end,coalesce(source_row->>'source_kind','soc'))
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
    if exists(select 1 from jsonb_array_elements(report_lines) l where l->>'source_kind'='restock') then
      select jsonb_agg(l||jsonb_build_object('source_kind',coalesce(l->>'source_kind','soc'))) into report_lines from jsonb_array_elements(report_lines) l;
    end if;
    report:=jsonb_build_object('contract_version',case when exists(select 1 from jsonb_array_elements(report_lines) l where l->>'source_kind'='restock') then 'hl-order-report-v3' else 'hl-order-report-v2' end,'kind',batch_kind,'order_id',order_id_value,
      'batch_id',batch_id_value,'ship_date',ship_date_value,'order_number',order_number_value,'created_at',now(),'lines',report_lines,
      'total_quantity',(select sum((value->>'quantity')::numeric) from jsonb_array_elements(report_lines)));
    insert into public.ph_hl_order_previews(id,created_by,expires_at,state_revision,source_fingerprint,report)
      values(preview_id,actor,now()+interval '30 minutes',current_revision+1,hl_order_private.batch_fingerprint(ship_date_value),report);
    preview_result:=jsonb_build_object('id',preview_id,'report',report);

  elsif p_action='submit' then
    select * into preview from public.ph_hl_order_previews where id=(p_payload->>'preview_id')::uuid;
    ship_date_value:=hl_order_private.ship_date(preview.report->>'ship_date');
    if not found or preview.created_by<>actor or preview.report->>'kind' not in ('submission','addition')
      or preview.report->>'contract_version' not in ('hl-order-report-v2','hl-order-report-v3') or ship_date_value is null or preview.expires_at<=now()
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
      insert into hl_order_private.order_lines(id,order_id,batch_id,source_id,source,quantity,source_kind)
        values((entry->>'line_id')::uuid,order_id_value,batch_id_value,source_id_value,entry-'line_id'-'quantity',(entry->>'quantity')::numeric,coalesce(entry->>'source_kind','soc'));
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
      if exists(select 1 from jsonb_array_elements(report_lines) l where l->>'source_kind'='restock') then
        select jsonb_agg(l||jsonb_build_object('source_kind',coalesce(l->>'source_kind','soc'))) into report_lines from jsonb_array_elements(report_lines) l;
      end if;
      report:=jsonb_build_object('contract_version',case when exists(select 1 from jsonb_array_elements(report_lines) l where l->>'source_kind'='restock') then 'hl-order-report-v3' when ord.ship_date is null then 'hl-order-report-v1' else 'hl-order-report-v2' end,'ship_date',ord.ship_date,'kind','cancellation','order_id',ord.id,'cancellation_id',cancellation_id_value,
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
        update hl_order_private.dispositions set status=case when source_kind='restock' then 'handled' else 'needs_review' end,available_quantity=case when source_kind='restock' then 0 else available_quantity+line.quantity end,
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


revoke all on function public.hl_order_restock_state(),public.hl_order_command(uuid,text,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function public.hl_order_restock_state(),public.hl_order_command(uuid,text,jsonb,bigint) to authenticated;
revoke all on all functions in schema hl_order_private from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
