-- Receipt-only PO accounting. Imports are immutable snapshots until Dylan
-- reconciles the report's inclusive receipt cutoff. No order/send deductions.
begin;
alter table public.ph_27f1_hl_po add column imported_po_remain numeric;
update public.ph_27f1_hl_po set imported_po_remain=po_remain;
-- Cutoffs use the actual receipt-write time, including commands that waited
-- for another transaction; historical timestamps remain unchanged.
alter table hl_order_private.receipts alter column created_at set default clock_timestamp();

create table hl_order_private.po_imports (
  id uuid primary key default gen_random_uuid(), run_id text not null unique,
  status text not null default 'staging' check(status in ('staging','pending','reconciled','duplicate')),
  created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  report_date date, row_count integer not null default 0, fingerprint text,
  duplicate_of uuid references hl_order_private.po_imports(id),
  receipt_cutoff timestamptz, reconciled_by uuid, reconciled_at timestamptz
);
create unique index hl_po_import_fingerprint on hl_order_private.po_imports(fingerprint)
  where status in ('pending','reconciled');
create table hl_order_private.po_import_rows (
  import_id uuid not null references hl_order_private.po_imports(id),
  source_file_id text not null, row_index integer not null, source jsonb not null,
  primary key(import_id,source_file_id,row_index)
);
create table hl_order_private.po_control (
  singleton boolean primary key default true check(singleton), active_scope text,
  active_import_id uuid references hl_order_private.po_imports(id),
  receipt_cutoff timestamptz not null
);
insert into hl_order_private.po_control(singleton,active_scope,receipt_cutoff)
  values(true,(select coalesce(nullif(run_id,''),source_file_id) from public.ph_27f1_hl_po order by imported_at desc,id desc limit 1),
    coalesce((select max(created_at) from hl_order_private.receipts),'1970-01-01'::timestamptz));
create table hl_order_private.po_receipt_adjustments (
  receipt_id uuid primary key references hl_order_private.receipts(id),
  itemcode text not null, size text not null, lot text not null default '27.F1' check(lot='27.F1'),
  quantity_delta numeric not null, created_at timestamptz not null
);
create index hl_po_receipt_balance on hl_order_private.po_receipt_adjustments(itemcode,size,created_at);
insert into hl_order_private.po_receipt_adjustments(receipt_id,itemcode,size,quantity_delta,created_at)
  select r.id,upper(btrim(l.source->>'itemcode')),upper(btrim(l.source->>'contsize')),r.quantity_delta,r.created_at
  from hl_order_private.receipts r join hl_order_private.order_lines l on l.id=r.line_id;
create table hl_order_private.po_import_previews (
  id uuid primary key default gen_random_uuid(), import_id uuid not null references hl_order_private.po_imports(id),
  created_by uuid not null, receipt_cutoff timestamptz not null, revision bigint not null,
  expires_at timestamptz not null default clock_timestamp()+interval '15 minutes', balances jsonb not null
);
alter table hl_order_private.po_imports enable row level security;
alter table hl_order_private.po_import_rows enable row level security;
alter table hl_order_private.po_control enable row level security;
alter table hl_order_private.po_receipt_adjustments enable row level security;
alter table hl_order_private.po_import_previews enable row level security;
revoke all on hl_order_private.po_imports,hl_order_private.po_import_rows,hl_order_private.po_control,
  hl_order_private.po_receipt_adjustments,hl_order_private.po_import_previews from public,anon,authenticated,service_role;

create function hl_order_private.po_match(p_item text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.ph_27f1_hl_po p join hl_order_private.po_control c
    on coalesce(nullif(p.run_id,''),p.source_file_id)=c.active_scope
    where nullif(upper(btrim(p.item_code)),'')=nullif(upper(btrim(p_item)),''))
$$;
create or replace function hl_order_private.sources() returns table(source_id text,source jsonb)
language sql stable security definer set search_path='' as $$
  select s.unique_id,n.source from public.ph_soc_master s
  cross join lateral (select hl_order_private.source(to_jsonb(s)) source) n
  where btrim(coalesce(s.unique_id,''))<>''
    and upper(n.source->>'invoicedate') in ('','NULL')
    and (n.source->>'dock'<>'' or n.source->>'planstartdate'<>'')
    and (upper(n.source->>'locationcode') in ('C.05','0.00.111')
      or upper(n.source->>'locationcode') ~ '^(C[.]12|B[.]10|C[.]14)[.].+')
    and hl_order_private.po_match(n.source->>'itemcode')
$$;

create function hl_order_private.po_balances(p_import_id uuid default null,p_cutoff timestamptz default null)
returns table(itemcode text,size text,status text,imported numeric,receipt_adjustment numeric,remaining numeric)
language sql stable security definer set search_path='' as $$
  with source_rows as (
    select p.item_code,p.size,p.lot,p.imported_po_remain balance from public.ph_27f1_hl_po p
      join hl_order_private.po_control c on coalesce(nullif(p.run_id,''),p.source_file_id)=c.active_scope where p_import_id is null
    union all
    select r.source->>'item_code',r.source->>'size',r.source->>'lot',(r.source->>'po_remain')::numeric
      from hl_order_private.po_import_rows r where r.import_id=p_import_id
  ), grouped as (
    select upper(btrim(item_code)) itemcode,upper(btrim(size)) size,count(distinct balance) values_count,count(*) filter(where balance is null) missing_count,min(balance) balance
    from source_rows where upper(btrim(lot))='27.F1' and nullif(btrim(item_code),'') is not null and nullif(btrim(size),'') is not null
    group by 1,2
  ), adjusted as (
    select g.*,coalesce((select sum(a.quantity_delta) from hl_order_private.po_receipt_adjustments a
      where a.itemcode=g.itemcode and a.size=g.size and a.created_at>coalesce(p_cutoff,(select receipt_cutoff from hl_order_private.po_control))),0) adjustment
    from grouped g
  ) select itemcode,size,case when values_count>1 then 'conflict' when missing_count>0 or values_count=0 then 'unknown' else 'ready' end,
    case when values_count=1 and missing_count=0 then balance end,adjustment,case when values_count=1 and missing_count=0 then balance-adjustment end from adjusted
$$;
create function hl_order_private.po_balance(p_source jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((select to_jsonb(b)||jsonb_build_object('lot','27.F1') from hl_order_private.po_balances() b
    where b.itemcode=upper(btrim(p_source->>'itemcode')) and b.size=upper(btrim(p_source->>'contsize'))),
    jsonb_build_object('itemcode',upper(btrim(p_source->>'itemcode')),'size',upper(btrim(p_source->>'contsize')),
      'lot','27.F1','status','missing','remaining',null,'imported',null,'receipt_adjustment',coalesce((
        select sum(a.quantity_delta) from hl_order_private.po_receipt_adjustments a where a.itemcode=upper(btrim(p_source->>'itemcode'))
        and a.size=upper(btrim(p_source->>'contsize')) and a.created_at>(select receipt_cutoff from hl_order_private.po_control)),0)))
$$;
create function hl_order_private.po_refresh_balances() returns void
language sql security definer set search_path='' as $$
  update public.ph_27f1_hl_po p set po_remain=b.remaining from hl_order_private.po_balances() b,hl_order_private.po_control c
    where coalesce(nullif(p.run_id,''),p.source_file_id)=c.active_scope and upper(btrim(p.lot))='27.F1'
      and upper(btrim(p.item_code))=b.itemcode and upper(btrim(p.size))=b.size and p.po_remain is distinct from b.remaining
$$;
create function hl_order_private.po_on_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
  -- Same global lock/order as HL commands and import confirmation. No external I/O.
  perform 1 from hl_order_private.state where singleton for update;
  select source into s from hl_order_private.order_lines where id=new.line_id;
  insert into hl_order_private.po_receipt_adjustments(receipt_id,itemcode,size,quantity_delta,created_at)
    values(new.id,upper(btrim(s->>'itemcode')),upper(btrim(s->>'contsize')),new.quantity_delta,new.created_at);
  perform hl_order_private.po_refresh_balances();
  return new;
end $$;
create trigger hl_po_receipt_adjustment after insert on hl_order_private.receipts for each row execute function hl_order_private.po_on_receipt();
create trigger hl_po_adjustment_immutable before update or delete on hl_order_private.po_receipt_adjustments
  for each row execute function hl_order_private.protect_history();
create trigger hl_po_preview_immutable before update or delete on hl_order_private.po_import_previews
  for each row execute function hl_order_private.protect_history();
create function hl_order_private.po_protect_import_row() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op<>'DELETE' and exists(select 1 from hl_order_private.po_imports where id=new.import_id and status='staging') then return new; end if;
  raise exception using errcode='55000',message='HL_PO_IMPORT_IMMUTABLE';
end $$;
create trigger hl_po_import_row_immutable before insert or update or delete on hl_order_private.po_import_rows
  for each row execute function hl_order_private.po_protect_import_row();

create function public.hl_po_import_capabilities() returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('version',1)
$$;
create function public.hl_po_import_stage(p_run_id text,p_rows jsonb,p_complete boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare imp hl_order_private.po_imports; row_value jsonb; parsed public.ph_27f1_hl_po; hash text; duplicate_id uuid; n integer;
begin
  if p_run_id is null or length(btrim(p_run_id)) not between 1 and 100 or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows)>1000 or octet_length(p_rows::text)>4000000 or p_complete is null then
    raise exception using errcode='22023',message='HL_PO_INVALID_IMPORT'; end if;
  perform 1 from hl_order_private.state where singleton for update;
  insert into hl_order_private.po_imports(run_id) values(p_run_id) on conflict(run_id) do nothing;
  select * into imp from hl_order_private.po_imports where run_id=p_run_id for update;
  for row_value in select value from jsonb_array_elements(p_rows) loop
    perform hl_order_private.assert_keys(row_value,array['source_file_id','source_file_name','source_sheet_name','report_date','run_id','row_index',
      'item_code','lot','size','common_name','po_ordered','genus','po_comments','lot_pend_rec','seas_on_hand','po_received','po_remain','imported_at','source_values']);
    if jsonb_typeof(row_value) is distinct from 'object' then raise exception using errcode='22023',message='HL_PO_INVALID_IMPORT'; end if;
    select * into parsed from jsonb_populate_record(null::public.ph_27f1_hl_po,row_value);
    if nullif(btrim(parsed.source_file_id),'') is null or parsed.row_index is null or parsed.row_index<0
      or parsed.po_remain::text in ('NaN','Infinity','-Infinity') then raise exception using errcode='22023',message='HL_PO_INVALID_IMPORT'; end if;
    row_value:=row_value-'run_id'-'imported_at';
    if imp.status<>'staging' then
      if not exists(select 1 from hl_order_private.po_import_rows r where r.import_id=imp.id and r.source_file_id=parsed.source_file_id
        and r.row_index=parsed.row_index and r.source=row_value) then raise exception using errcode='55000',message='HL_PO_IMPORT_IMMUTABLE'; end if;
    else
      insert into hl_order_private.po_import_rows(import_id,source_file_id,row_index,source) values(imp.id,parsed.source_file_id,parsed.row_index,row_value)
        on conflict(import_id,source_file_id,row_index) do update set source=excluded.source;
    end if;
  end loop;
  if p_complete and imp.status='staging' then
    select count(*),hl_order_private.fingerprint(jsonb_agg(source-'source_file_id'-'source_file_name'-'source_sheet_name'-'source_values'-'row_index' order by (source-'source_file_id'-'source_file_name'-'source_sheet_name'-'source_values'-'row_index')::text)) into n,hash
      from hl_order_private.po_import_rows where import_id=imp.id;
    if n=0 then raise exception using errcode='22023',message='HL_PO_EMPTY_IMPORT'; end if;
    select id into duplicate_id from hl_order_private.po_imports where fingerprint=hash and status in ('pending','reconciled');
    update hl_order_private.po_imports set status=case when duplicate_id is null then 'pending' else 'duplicate' end,
      duplicate_of=duplicate_id,fingerprint=hash,row_count=n,completed_at=clock_timestamp(),
      report_date=(select max((source->>'report_date')::date) from hl_order_private.po_import_rows where import_id=imp.id) where id=imp.id returning * into imp;
    update hl_order_private.state set revision=revision+1 where singleton;
  end if;
  return jsonb_build_object('id',imp.id,'status',imp.status,'row_count',imp.row_count,'duplicate_of',imp.duplicate_of,
    'awaitingReconciliation',imp.status='pending');
end $$;
revoke all on function public.hl_po_import_capabilities(),public.hl_po_import_stage(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.hl_po_import_capabilities(),public.hl_po_import_stage(text,jsonb,boolean) to service_role;
-- Active import rows are now changed only by the protected receipt/import workflow.
revoke insert,update,delete on public.ph_27f1_hl_po from service_role;

alter function hl_order_private.state_json() rename to state_json_before_po;
create function hl_order_private.state_json() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb; o jsonb; d jsonb; a jsonb; orders jsonb:='[]'; drafts jsonb:='[]'; actionable jsonb:='[]'; lines jsonb; l jsonb;
begin
  s:=hl_order_private.state_json_before_po();
  for a in select value from jsonb_array_elements(s->'actionable_rows') loop
    actionable:=actionable||jsonb_build_array(a||jsonb_build_object('po_match',true,'po_balance',hl_order_private.po_balance(a)));
  end loop;
  for d in select value from jsonb_array_elements(s->'draft') loop
    drafts:=drafts||jsonb_build_array(d||jsonb_build_object('po_match',hl_order_private.po_match(d->'source'->>'itemcode'),'po_balance',hl_order_private.po_balance(d->'source')));
  end loop;
  for o in select value from jsonb_array_elements(s->'orders') loop
    lines:='[]';
    for l in select value from jsonb_array_elements(o->'lines') loop
      lines:=lines||jsonb_build_array(l||jsonb_build_object('po_match',hl_order_private.po_match(l->'source'->>'itemcode'),'po_balance',hl_order_private.po_balance(l->'source')));
    end loop;
    orders:=orders||jsonb_build_array(o||jsonb_build_object('lines',lines));
  end loop;
  return s||jsonb_build_object('actionable_rows',actionable,'draft',drafts,'orders',orders,
    'po_receipt_cutoff',(select receipt_cutoff from hl_order_private.po_control),
    'po_imports',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'created_at',i.created_at,
      'report_date',i.report_date,'row_count',i.row_count) order by i.created_at desc,i.id desc) from hl_order_private.po_imports i where status='pending' and i.id=(select id from hl_order_private.po_imports where status in ('pending','reconciled') order by created_at desc,id desc limit 1)),'[]'));
end $$;

alter function public.hl_order_command(uuid,text,jsonb,bigint) set schema hl_order_private;
alter function hl_order_private.hl_order_command(uuid,text,jsonb,bigint) rename to command_before_po;
revoke all on function hl_order_private.command_before_po(uuid,text,jsonb,bigint) from public,anon,authenticated,service_role;
create function public.hl_order_command(p_command_id uuid,p_action text,p_payload jsonb,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=hl_order_private.assert_dylan(); rev bigint; request_hash text; saved hl_order_private.commands;
  imp hl_order_private.po_imports; preview hl_order_private.po_import_previews; cutoff timestamptz; result jsonb; rows jsonb; parsed public.ph_27f1_hl_po; row_value jsonb;
begin
  if p_action not in ('po_import_preview','po_import_confirm') or p_action is null then
    return hl_order_private.command_before_po(p_command_id,p_action,p_payload,p_expected_revision);
  end if;
  if p_command_id is null or p_expected_revision is null or p_expected_revision<0 or octet_length(coalesce(p_payload::text,''))>200000 then
    raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
  perform hl_order_private.assert_keys(p_payload,case when p_action='po_import_preview' then array['import_id','receipt_cutoff'] else array['preview_id'] end);
  request_hash:=hl_order_private.fingerprint(jsonb_build_array(p_action,p_payload,p_expected_revision));
  select revision into rev from hl_order_private.state where singleton for update;
  select * into saved from hl_order_private.commands where command_id=p_command_id;
  if found then
    if saved.created_by<>actor or saved.request_hash<>request_hash then raise exception using errcode='22023',message='HL_ORDER_COMMAND_ID_CONFLICT'; end if;
    return saved.response;
  end if;
  if rev<>p_expected_revision then raise exception using errcode='40001',message='HL_ORDER_REVISION_CONFLICT'; end if;
  if p_action='po_import_preview' then
    if coalesce(p_payload->>'receipt_cutoff','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='HL_PO_INVALID_CUTOFF'; end if;
    cutoff:=(p_payload->>'receipt_cutoff')::timestamptz;
    select * into imp from hl_order_private.po_imports where id=(p_payload->>'import_id')::uuid and status='pending';
    if not found then raise exception using errcode='55000',message='HL_PO_IMPORT_NOT_PENDING'; end if;
    if cutoff>clock_timestamp() or cutoff>imp.created_at or cutoff<(select receipt_cutoff from hl_order_private.po_control) then
      raise exception using errcode='22023',message='HL_PO_INVALID_CUTOFF'; end if;
    if imp.id<>(select id from hl_order_private.po_imports where status in ('pending','reconciled') order by created_at desc,id desc limit 1) then
      raise exception using errcode='55000',message='HL_PO_IMPORT_SUPERSEDED'; end if;
    select coalesce(jsonb_agg(to_jsonb(b) order by itemcode,size),'[]') into rows from hl_order_private.po_balances(imp.id,cutoff) b;
    insert into hl_order_private.po_import_previews(import_id,created_by,receipt_cutoff,revision,balances)
      values(imp.id,actor,cutoff,rev+1,rows) returning * into preview;
  else
    select * into preview from hl_order_private.po_import_previews where id=(p_payload->>'preview_id')::uuid;
    if not found or preview.created_by<>actor or preview.revision<>rev or preview.expires_at<=clock_timestamp() then
      raise exception using errcode='55000',message='HL_PO_PREVIEW_STALE'; end if;
    select * into imp from hl_order_private.po_imports where id=preview.import_id and status='pending';
    if not found or imp.id<>(select id from hl_order_private.po_imports where status in ('pending','reconciled') order by created_at desc,id desc limit 1) then
      raise exception using errcode='55000',message='HL_PO_IMPORT_SUPERSEDED'; end if;
    if preview.receipt_cutoff<(select receipt_cutoff from hl_order_private.po_control) then
      raise exception using errcode='55000',message='HL_PO_PREVIEW_STALE'; end if;
    -- The state lock serializes receipt writes, and this source lock keeps
    -- authoritative source-review reconciliation atomic with report activation.
    lock table public.ph_soc_master in share mode;
    for row_value in select source from hl_order_private.po_import_rows where import_id=imp.id order by source_file_id,row_index loop
      select * into parsed from jsonb_populate_record(null::public.ph_27f1_hl_po,row_value);
      insert into public.ph_27f1_hl_po(source_file_id,source_file_name,source_sheet_name,report_date,run_id,row_index,item_code,lot,size,common_name,
        po_ordered,genus,po_comments,lot_pend_rec,seas_on_hand,po_received,po_remain,imported_po_remain,imported_at)
      values(parsed.source_file_id,parsed.source_file_name,parsed.source_sheet_name,parsed.report_date,imp.id::text,parsed.row_index,parsed.item_code,
        parsed.lot,parsed.size,parsed.common_name,parsed.po_ordered,parsed.genus,parsed.po_comments,parsed.lot_pend_rec,parsed.seas_on_hand,parsed.po_received,
        parsed.po_remain,parsed.po_remain,clock_timestamp())
      on conflict(source_file_id,row_index) do update set source_file_name=excluded.source_file_name,source_sheet_name=excluded.source_sheet_name,
        report_date=excluded.report_date,run_id=excluded.run_id,item_code=excluded.item_code,lot=excluded.lot,size=excluded.size,common_name=excluded.common_name,
        po_ordered=excluded.po_ordered,genus=excluded.genus,po_comments=excluded.po_comments,lot_pend_rec=excluded.lot_pend_rec,seas_on_hand=excluded.seas_on_hand,
        po_received=excluded.po_received,po_remain=excluded.po_remain,imported_po_remain=excluded.imported_po_remain,imported_at=excluded.imported_at;
    end loop;
    update hl_order_private.po_control set active_scope=imp.id::text,active_import_id=imp.id,receipt_cutoff=preview.receipt_cutoff where singleton;
    update hl_order_private.po_imports set status='reconciled',receipt_cutoff=preview.receipt_cutoff,reconciled_by=actor,reconciled_at=clock_timestamp() where id=imp.id;
    perform hl_order_private.po_refresh_balances();
    perform hl_order_private.reconcile();
  end if;
  update hl_order_private.state set revision=revision+1 where singleton;
  insert into hl_order_private.history(command_id,action,payload,created_by) values(p_command_id,p_action,p_payload,actor);
  result:=hl_order_private.state_json();
  if p_action='po_import_preview' then result:=result||jsonb_build_object('po_import_preview',to_jsonb(preview)); end if;
  insert into hl_order_private.commands(command_id,created_by,request_hash,response) values(p_command_id,actor,request_hash,result);
  return result;
end $$;
revoke all on function public.hl_order_command(uuid,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.hl_order_command(uuid,text,jsonb,bigint) to authenticated;
revoke all on all functions in schema hl_order_private from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
