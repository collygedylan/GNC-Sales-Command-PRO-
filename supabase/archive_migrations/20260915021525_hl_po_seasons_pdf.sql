-- PDF detail lines are immutable provenance. Public PO tables are read models;
-- all accounting uses one lot-aware aggregate over the confirmed report.
begin;
alter table hl_order_private.po_imports add column source_format text not null default 'legacy';
alter table hl_order_private.po_imports add column metadata jsonb;
create table hl_order_private.po_pdf_pages(import_id uuid not null references hl_order_private.po_imports(id),page integer not null check(page>0),rows jsonb not null,primary key(import_id,page));
alter table hl_order_private.po_pdf_pages enable row level security;
create table hl_order_private.restock_targets(
 id uuid primary key default gen_random_uuid(),itemcode text not null,size text not null,lot text not null check(lot in ('27.F1','27.S1')),
 target numeric not null check(target>=0),basis_quantity numeric not null check(basis_quantity>=0),basis_import_id uuid not null references hl_order_private.po_imports(id),
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(),unique(itemcode,size,lot));
create table hl_order_private.restock_target_previews(id uuid primary key default gen_random_uuid(),created_by uuid not null,revision bigint not null,
 expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',items jsonb not null);
create table hl_order_private.restock_target_history(id bigint generated always as identity primary key,target_id uuid not null,previous_target numeric,
 target numeric not null,basis_quantity numeric not null,basis_import_id uuid not null,created_by uuid not null,created_at timestamptz not null default clock_timestamp());
alter table hl_order_private.restock_targets enable row level security;
alter table hl_order_private.restock_target_previews enable row level security;
alter table hl_order_private.restock_target_history enable row level security;
create trigger hl_restock_target_preview_immutable before update or delete on hl_order_private.restock_target_previews for each row execute function hl_order_private.protect_history();
create trigger hl_restock_target_history_immutable before update or delete on hl_order_private.restock_target_history for each row execute function hl_order_private.protect_history();
alter table hl_order_private.po_receipt_adjustments drop constraint po_receipt_adjustments_lot_check;
alter table hl_order_private.po_receipt_adjustments add check(lot in ('27.F1','27.S1'));
alter table hl_order_private.restock_intents add column lot text not null default '27.F1' check(lot in ('27.F1','27.S1'));
alter table hl_order_private.restock_inventory_gates add column lot text not null default '27.F1' check(lot in ('27.F1','27.S1'));
alter table hl_order_private.restock_inventory_gates drop constraint restock_inventory_gates_pkey;
alter table hl_order_private.restock_inventory_gates add primary key(itemcode,size,lot);
alter table hl_order_private.dispositions add column po_lot text not null default '27.F1' check(po_lot in ('27.F1','27.S1'));
alter table hl_order_private.drafts add column po_lot text not null default '27.F1' check(po_lot in ('27.F1','27.S1'));
alter table hl_order_private.order_lines add column po_lot text not null default '27.F1' check(po_lot in ('27.F1','27.S1'));
create function hl_order_private.preserve_po_lot() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then new.po_lot:=old.po_lot;
 else new.po_lot:=coalesce((select po_lot from hl_order_private.dispositions where source_id=new.source_id),upper(btrim(new.source->>'lotcode')));
 if new.po_lot is null or new.po_lot not in ('27.F1','27.S1') then raise exception 'HL_PO_LOT_REVIEW_REQUIRED'; end if; end if;
 return new;
end $$;
create trigger hl_po_disposition_lot before insert or update on hl_order_private.dispositions for each row execute function hl_order_private.preserve_po_lot();
create trigger hl_po_draft_lot before insert or update on hl_order_private.drafts for each row execute function hl_order_private.preserve_po_lot();
create trigger hl_po_line_lot before insert or update on hl_order_private.order_lines for each row execute function hl_order_private.preserve_po_lot();
create index hl_po_receipt_lot on hl_order_private.po_receipt_adjustments(itemcode,size,lot,created_at);

-- Preserve existing raw F1 table contract as a generated read model. S1 has the
-- same columns, permissions and source-revision behavior, but no second ledger.
create table public.ph_27s1_hl_po(like public.ph_27f1_hl_po including defaults including identity including constraints);
alter table public.ph_27s1_hl_po add primary key(id);
create unique index ph_27s1_hl_po_source_file_row_key on public.ph_27s1_hl_po(source_file_id,row_index);
alter table public.ph_27s1_hl_po enable row level security;
create policy ph_27s1_hl_po_manager_read on public.ph_27s1_hl_po for select to authenticated using(app_sync_private.can_read_source('ph_27s1_hl_po') and exists(select 1 from public.profiles p where p.id=auth.uid() and upper(p.role) in ('ADMIN','MANAGER')));
grant select on public.ph_27s1_hl_po to authenticated,service_role;
revoke all on public.ph_27s1_hl_po from anon;
insert into app_sync_private.sources(key,modules) values('ph_27s1_hl_po','{po-management}');
insert into public.app_dataset_revisions(key) values('ph_27s1_hl_po');
create trigger app_dataset_revision_inserted after insert on public.ph_27s1_hl_po referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated after update on public.ph_27s1_hl_po referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted after delete on public.ph_27s1_hl_po referencing old table as app_dataset_old_rows for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated after truncate on public.ph_27s1_hl_po for each statement execute function app_sync_private.touch_source();

create function public.hl_po_pdf_stage(p_run_id text,p_metadata jsonb,p_page integer,p_rows jsonb,p_complete boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare imp hl_order_private.po_imports; r jsonb; idx integer; duplicate_id uuid; pages integer; n integer;
begin
 if length(coalesce(p_run_id,'')) not between 1 and 200 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>1000
 or octet_length(p_rows::text)>4000000 or coalesce(p_metadata->>'fingerprint','') !~ '^[a-f0-9]{64}$'
 or nullif(p_metadata->>'source_file_id','') is null or nullif(p_metadata->>'parser_version','') is null
 or nullif(p_metadata->>'report_printed_at','') is null or p_complete is null then raise exception 'HL_PO_INVALID_PDF'; end if;
 pages:=(p_metadata->>'page_count')::integer;
 if pages not between 1 and 1000 or (p_page is not null and p_page not between 1 and pages) then raise exception 'HL_PO_INVALID_PDF'; end if;
 perform 1 from hl_order_private.state where singleton for update;
 insert into hl_order_private.po_imports(run_id,source_format,metadata) values(p_run_id,'pdf',p_metadata) on conflict(run_id) do nothing;
 select * into imp from hl_order_private.po_imports where run_id=p_run_id for update;
 if imp.source_format<>'pdf' or imp.metadata<>p_metadata then raise exception 'HL_PO_IMPORT_IMMUTABLE'; end if;
 if p_page is not null then
  if exists(select 1 from hl_order_private.po_pdf_pages where import_id=imp.id and page=p_page and rows<>p_rows) then raise exception 'HL_PO_IMPORT_IMMUTABLE'; end if;
  if not exists(select 1 from hl_order_private.po_pdf_pages where import_id=imp.id and page=p_page) then
   if imp.status<>'staging' then raise exception 'HL_PO_IMPORT_IMMUTABLE'; end if;
   idx:=0;
   for r in select value from jsonb_array_elements(p_rows) loop
    idx:=idx+1;
    if nullif(btrim(r->>'item_code'),'') is null or nullif(btrim(r->>'size'),'') is null or nullif(btrim(r->>'lot'),'') is null
      or nullif(r->>'po_number','') is null or nullif(r->>'vendor','') is null
      or jsonb_typeof(r->'po_remain') is distinct from 'number' or (r->>'po_remain')::numeric<0
      or (r->>'po_remain')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'HL_PO_INVALID_PDF_LINE'; end if;
    insert into hl_order_private.po_import_rows(import_id,source_file_id,row_index,source) values(imp.id,p_metadata->>'source_file_id',p_page*10000+idx,
     r||jsonb_build_object('source_file_id',p_metadata->>'source_file_id','source_file_name',p_metadata->>'source_file_name','report_date',p_metadata->>'report_date','page',p_page,'line_index',idx));
   end loop;
   insert into hl_order_private.po_pdf_pages values(imp.id,p_page,p_rows);
  end if;
 end if;
 if p_complete and imp.status='staging' then
  if (select count(*) from hl_order_private.po_pdf_pages where import_id=imp.id)<>pages then raise exception 'HL_PO_PDF_INCOMPLETE'; end if;
  select count(*) into n from hl_order_private.po_import_rows where import_id=imp.id;
  if n=0 then raise exception 'HL_PO_EMPTY_IMPORT'; end if;
  select id into duplicate_id from hl_order_private.po_imports where fingerprint=p_metadata->>'fingerprint' and status in ('pending','reconciled');
  update hl_order_private.po_imports set status=case when duplicate_id is null then 'pending' else 'duplicate' end,duplicate_of=duplicate_id,
   fingerprint=p_metadata->>'fingerprint',row_count=n,completed_at=clock_timestamp(),report_date=(p_metadata->>'report_date')::date where id=imp.id returning * into imp;
  update hl_order_private.state set revision=revision+1 where singleton;
 end if;
 return jsonb_build_object('id',imp.id,'status',imp.status,'row_count',imp.row_count,'duplicate_of',imp.duplicate_of,'awaitingReconciliation',imp.status='pending',
 'completed_pages',coalesce((select jsonb_agg(page order by page) from hl_order_private.po_pdf_pages where import_id=imp.id),'[]'));
end $$;
create or replace function public.hl_po_import_capabilities() returns jsonb language sql security definer set search_path='' as $$ select jsonb_build_object('version',2,'pdf',true,'quantity_summary',false) $$;
-- Old importer cannot activate a quantity-summary replacement after this change.
create or replace function public.hl_po_import_stage(p_run_id text,p_rows jsonb,p_complete boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin raise exception using errcode='55000',message='HL_PO_ORIGINAL_PDF_REQUIRED'; end $$;

alter function hl_order_private.po_balances(uuid,timestamptz) rename to po_balances_legacy;
create function hl_order_private.po_balances_v2(p_import_id uuid default null,p_cutoff timestamptz default null)
returns table(itemcode text,size text,lot text,status text,imported numeric,receipt_adjustment numeric,remaining numeric,po_ordered numeric,commonname text)
language sql stable security definer set search_path='' as $$
 with active as materialized(select coalesce(p_import_id,c.active_import_id) id,coalesce(p_cutoff,c.receipt_cutoff) cutoff from hl_order_private.po_control c),
 grouped as materialized(select upper(btrim(r.source->>'item_code')) itemcode,upper(btrim(r.source->>'size')) size,upper(btrim(r.source->>'lot')) lot,
 sum((r.source->>'po_remain')::numeric) imported,sum((r.source->>'po_ordered')::numeric) po_ordered,min(r.source->>'common_name') commonname
 from hl_order_private.po_import_rows r join active a on a.id=r.import_id join hl_order_private.po_imports i on i.id=r.import_id and i.source_format='pdf'
 where upper(btrim(r.source->>'lot')) in ('27.F1','27.S1') group by 1,2,3),
 adjustments as materialized(select a.itemcode,a.size,a.lot,sum(a.quantity_delta) quantity from hl_order_private.po_receipt_adjustments a cross join active c where a.created_at>c.cutoff group by 1,2,3)
 select g.itemcode,g.size,g.lot,'ready',g.imported,coalesce(a.quantity,0),g.imported-coalesce(a.quantity,0),g.po_ordered,g.commonname
 from grouped g left join adjustments a using(itemcode,size,lot)
 union all select b.itemcode,b.size,'27.F1',b.status,b.imported,b.receipt_adjustment,b.remaining,null,null
 from hl_order_private.po_balances_legacy(p_import_id,p_cutoff) b
 where not exists(select 1 from active a join hl_order_private.po_imports i on i.id=a.id and i.source_format='pdf')
$$;
create function hl_order_private.po_balances(p_import_id uuid default null,p_cutoff timestamptz default null)
returns table(itemcode text,size text,status text,imported numeric,receipt_adjustment numeric,remaining numeric)
language sql stable security definer set search_path='' as $$ select itemcode,size,status,imported,receipt_adjustment,remaining from hl_order_private.po_balances_v2(p_import_id,p_cutoff) where lot='27.F1' $$;
create function hl_order_private.po_match_v2(p_item text,p_lot text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from hl_order_private.po_balances_v2() b where b.itemcode=upper(btrim(p_item)) and b.lot=upper(btrim(p_lot))) $$;
create or replace function hl_order_private.sources() returns table(source_id text,source jsonb) language sql stable security definer set search_path='' as $$
 with membership as materialized(select distinct itemcode,lot from hl_order_private.po_balances_v2())
 select s.unique_id,n.source from public.ph_soc_master s cross join lateral(select hl_order_private.source(to_jsonb(s)) source)n
 join membership p on p.itemcode=upper(btrim(n.source->>'itemcode')) and p.lot=upper(btrim(n.source->>'lotcode'))
 where btrim(coalesce(s.unique_id,''))<>'' and upper(n.source->>'invoicedate') in ('','NULL') and (n.source->>'dock'<>'' or n.source->>'planstartdate'<>'')
 and (upper(n.source->>'locationcode') in ('C.05','0.00.111') or upper(n.source->>'locationcode')~'^(C[.]12|B[.]10|C[.]14)[.].+')
 $$;

alter function hl_order_private.po_refresh_balances() rename to po_refresh_balances_legacy;
create function hl_order_private.po_refresh_balances() returns void language plpgsql security definer set search_path='' as $$
declare imp hl_order_private.po_imports;
begin
 select i.* into imp from hl_order_private.po_imports i join hl_order_private.po_control c on c.active_import_id=i.id;
 if imp.source_format is distinct from 'pdf' then perform hl_order_private.po_refresh_balances_legacy(); return; end if;
 -- A single synthetic row per balance is a compatibility projection, not a PO
 -- detail line. Original PDF lines remain untouched in po_import_rows.
 insert into public.ph_27f1_hl_po(source_file_id,source_file_name,report_date,run_id,row_index,item_code,lot,size,common_name,po_ordered,po_remain,imported_po_remain,imported_at)
 select 'pdf:'||imp.id,imp.metadata->>'source_file_name',imp.report_date,imp.id::text,row_number() over(order by itemcode,size),itemcode,lot,size,commonname,po_ordered,remaining,imported,imp.reconciled_at
 from hl_order_private.po_balances_v2() where lot='27.F1'
 on conflict(source_file_id,row_index) do update set po_remain=excluded.po_remain;
 insert into public.ph_27s1_hl_po(source_file_id,source_file_name,report_date,run_id,row_index,item_code,lot,size,common_name,po_ordered,po_remain,imported_po_remain,imported_at)
 select 'pdf:'||imp.id,imp.metadata->>'source_file_name',imp.report_date,imp.id::text,row_number() over(order by itemcode,size),itemcode,lot,size,commonname,po_ordered,remaining,imported,imp.reconciled_at
 from hl_order_private.po_balances_v2() where lot='27.S1'
 on conflict(source_file_id,row_index) do update set po_remain=excluded.po_remain;
end $$;
create or replace function hl_order_private.po_on_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare s hl_order_private.order_lines;
begin
 perform 1 from hl_order_private.state where singleton for update;
 select * into s from hl_order_private.order_lines where id=new.line_id;
 insert into hl_order_private.po_receipt_adjustments(receipt_id,itemcode,size,lot,quantity_delta,created_at) values(new.id,upper(btrim(s.source->>'itemcode')),upper(btrim(s.source->>'contsize')),s.po_lot,new.quantity_delta,new.created_at);
 perform hl_order_private.po_refresh_balances(); return new;
end $$;

create or replace function hl_order_private.restock_receipt_gate() returns trigger
language plpgsql security definer set search_path='' as $$
declare s jsonb; code text; sz text; scope_lot text;
begin
  perform 1 from hl_order_private.state where singleton for update;
  select source into s from hl_order_private.order_lines where id=new.line_id;
  select po_lot into scope_lot from hl_order_private.order_lines where id=new.line_id;
  if s->>'source_kind' is distinct from 'restock' then return new; end if;
  code:=upper(btrim(s->>'itemcode')); sz:=upper(btrim(s->>'contsize'));
  insert into hl_order_private.restock_inventory_gates(itemcode,size,lot,receipt_watermark,receipt_revision,receipt_at)
    values(code,sz,scope_lot,1,coalesce((select revision from public.app_dataset_revisions where key='ph_master_inventory'),0),new.created_at)
    on conflict(itemcode,size,lot) do update set receipt_watermark=restock_inventory_gates.receipt_watermark+1,
      receipt_revision=excluded.receipt_revision,receipt_at=excluded.receipt_at;
  return new;
end $$;

create function hl_order_private.restock_items_v2(p_lot text) returns setof jsonb
language sql stable security definer set search_path='' as $$
  with po as materialized (select b.itemcode,b.size,b.commonname,b.po_ordered,b.remaining,b.status balance_status,t.target,t.id target_id,t.basis_quantity,t.basis_import_id,t.id is not null target_initialized,p_lot lot from hl_order_private.po_balances_v2() b left join hl_order_private.restock_targets t on t.itemcode=b.itemcode and t.size=b.size and t.lot=b.lot where b.lot=p_lot
  ), balances as materialized (select * from hl_order_private.po_balances_v2() where lot=p_lot), master_ids as materialized (
    select upper(btrim(m.itemcode)) itemcode,upper(btrim(m.contsize)) size,m.unique_id,
      case when nullif(btrim(m.unique_id),'') is not null and count(distinct hl_order_private.quantity(m.ptravailable::text))=1
        and bool_and(hl_order_private.quantity(m.ptravailable::text) is not null) then min(hl_order_private.quantity(m.ptravailable::text)) end available
    from public.ph_master_inventory m join po p on p.itemcode=upper(btrim(m.itemcode)) and p.size=upper(btrim(m.contsize))
    where upper(btrim(m.lotcode))=p_lot and lower(btrim(coalesce(m.app_tab_assignment,''))) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
      and (not exists(select 1 from public.profiles p where p.id=auth.uid() and upper(p.role) like '%FOREMAN%')
        or upper(btrim(coalesce(m.priority,''))) not in ('','-','--','---','N/A','NA','NULL','NONE'))
    group by 1,2,m.unique_id
  ), master as (
    select itemcode,size,case when bool_and(available is not null) then sum(available) end available from master_ids group by 1,2
  ), saved as (
    select i.itemcode,i.size,sum(d.quantity) quantity,min(d.source_id) source_id from hl_order_private.drafts d
    join hl_order_private.restock_intents i using(source_id) join hl_order_private.dispositions x using(source_id)
    where x.status='draft' and i.lot=p_lot group by 1,2
  ), incoming as (
    select i.itemcode,i.size,sum(l.quantity-l.received_quantity-l.cancelled_quantity) quantity
    from hl_order_private.order_lines l join hl_order_private.restock_intents i using(source_id) where i.lot=p_lot group by 1,2
  ), receipt_review as (
    select i.itemcode,i.size,jsonb_agg(jsonb_build_object('id',r.id,'order_number',o.order_number,
      'received_quantity',r.received_quantity,'previous_quantity',r.previous_quantity,'quantity_delta',r.quantity_delta,'created_at',r.created_at)
      order by r.created_at,r.id) receipts
    from hl_order_private.receipts r join hl_order_private.order_lines l on l.id=r.line_id
    join hl_order_private.restock_intents i on i.source_id=l.source_id join hl_order_private.orders o on o.id=r.order_id
    left join hl_order_private.restock_inventory_gates g on g.itemcode=i.itemcode and g.size=i.size and g.lot=i.lot
    where i.lot=p_lot and (g.confirmed_at is null or r.created_at>g.confirmed_at) group by i.itemcode,i.size
  ), amounts as (
    select p.*,case when m.itemcode is null then 0 else m.available end available,coalesce(s.quantity,0) saved_quantity,s.source_id,
      coalesce(n.quantity,0) incoming_quantity,coalesce(g.receipt_watermark,0) receipt_watermark,
      coalesce(rr.receipts,'[]'::jsonb) receipts,snap->>'changed_at' inventory_updated_at,
      case when snap->>'state' is distinct from 'ready' then 'inventory_verifying'
        when p.balance_status<>'ready' or p.remaining is null or p.remaining<0 then 'po_unknown' when p.target is null then 'target_needed' when m.itemcode is not null and m.available is null then 'inventory_unknown'
        when g.receipt_watermark>g.confirmed_watermark then 'receipt_pending' else 'ready' end status,
      coalesce(g.receipt_watermark>g.confirmed_watermark and (snap->>'master_revision')::bigint>g.receipt_revision
        and (snap->>'changed_at')::timestamptz>g.receipt_at and snap->>'state'='ready' and (m.itemcode is null or m.available is not null),false) can_confirm_inventory
    from po p left join master m using(itemcode,size) left join saved s using(itemcode,size)
    left join incoming n using(itemcode,size) left join hl_order_private.restock_inventory_gates g on g.itemcode=p.itemcode and g.size=p.size and g.lot=p_lot
    left join receipt_review rr on rr.itemcode=p.itemcode and rr.size=p.size
    cross join lateral(select hl_order_private.restock_snapshot() snap) snapshot
  ) select to_jsonb(a)||jsonb_build_object('suggested_quantity',case when a.status='ready' then greatest(0,ceil(target-available-saved_quantity-incoming_quantity)) end,
    'po_balance',to_jsonb(b)||jsonb_build_object('lot',p_lot)) from amounts a left join balances b using(itemcode,size) order by itemcode,size
$$;


create or replace function hl_order_private.restock_items() returns setof jsonb language sql stable security definer set search_path='' as $$ select * from hl_order_private.restock_items_v2('27.F1') $$;
create function public.hl_order_restock_state_v2(p_lot text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform hl_order_private.assert_dylan();
 if p_lot is null or p_lot not in ('27.F1','27.S1') then raise exception 'HL_PO_LOT_REVIEW_REQUIRED'; end if;
  if app_sync_private.can_read_source('ph_master_inventory') is distinct from true then
    raise exception using errcode='42501',message='HL_RESTOCK_INVENTORY_FORBIDDEN'; end if;
  perform 1 from hl_order_private.state where singleton for update;
  lock table public.ph_master_inventory in share mode;
  perform 1 from public.app_dataset_revisions where key='ph_master_inventory' for share;
  return jsonb_build_object('revision',(select revision from hl_order_private.state where singleton),
    'inventory_snapshot',hl_order_private.restock_snapshot(),'items',coalesce((select jsonb_agg(i) from hl_order_private.restock_items_v2(p_lot) i),'[]'));
end $$;


create or replace function public.hl_order_restock_state() returns jsonb language sql security definer set search_path='' as $$ select public.hl_order_restock_state_v2('27.F1') $$;
create or replace function hl_order_private.validate_restock_drafts(p_date date) returns void
language plpgsql security definer set search_path='' as $$
declare d record; item jsonb; items jsonb; snap jsonb:=hl_order_private.restock_snapshot();
begin
  if not exists(select 1 from hl_order_private.drafts q join hl_order_private.dispositions x using(source_id)
    where q.source_kind='restock' and x.status='draft' and q.ship_date=p_date) then return; end if;
  if app_sync_private.can_read_source('ph_master_inventory') is distinct from true then
    raise exception using errcode='42501',message='HL_RESTOCK_INVENTORY_FORBIDDEN'; end if;
  select jsonb_agg(value) into items from (select * from hl_order_private.restock_items_v2('27.F1') union all select * from hl_order_private.restock_items_v2('27.S1')) q(value);
  for d in select q.* from hl_order_private.drafts q join hl_order_private.dispositions x using(source_id)
    where q.source_kind='restock' and x.status='draft' and q.ship_date=p_date loop
    select i into item from jsonb_array_elements(items) i where i->>'itemcode'=d.source->>'itemcode' and i->>'size'=d.source->>'contsize' and i->>'lot'=d.po_lot;
    if item is null or item->>'status'<>'ready' or d.source->'inventory_snapshot' is distinct from snap
      or (item->>'saved_quantity')::numeric>greatest(0,ceil((item->>'target')::numeric-(item->>'available')::numeric-(item->>'incoming_quantity')::numeric)) then
      raise exception using errcode='55000',message='HL_RESTOCK_REVIEW_REQUIRED';
    end if;
  end loop;
end $$;


create or replace function public.hl_order_command(p_command_id uuid,p_action text,p_payload jsonb,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=hl_order_private.assert_dylan(); rev bigint; request_hash text; saved hl_order_private.commands;
  snap jsonb; item jsonb; items jsonb; entry jsonb; source_value jsonb; source_id_value text; code text; sz text; qty numeric; prior_qty numeric;
  scope_lot text:=coalesce(p_payload->>'lot','27.F1'); day date; gate hl_order_private.restock_inventory_gates; result jsonb; seen text[]:='{}';
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
  if p_action in ('po_import_preview','po_import_confirm','restock_target_preview','restock_target_confirm') then return hl_order_private.po_season_command(p_command_id,p_action,p_payload,p_expected_revision); end if;
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
  perform hl_order_private.assert_keys(p_payload,case when p_action='restock_draft_save' then array['lot','ship_date','rows','inventory_snapshot'] else array['lot','itemcode','size','inventory_snapshot','receipt_watermark'] end);
  if scope_lot not in ('27.F1','27.S1') then raise exception 'HL_PO_LOT_REVIEW_REQUIRED'; end if;
  if app_sync_private.can_read_source('ph_master_inventory') is distinct from true then
    raise exception using errcode='42501',message='HL_RESTOCK_INVENTORY_FORBIDDEN'; end if;
  if rev<>p_expected_revision then raise exception using errcode='40001',message='HL_ORDER_REVISION_CONFLICT'; end if;
  if snap is null or snap->>'state'<>'ready' or p_payload->'inventory_snapshot' is distinct from snap then
    raise exception using errcode='55000',message='HL_RESTOCK_INVENTORY_STALE'; end if;
  select jsonb_agg(i) into items from hl_order_private.restock_items_v2(scope_lot) i;
  if p_action='restock_inventory_confirm' then
    code:=upper(btrim(p_payload->>'itemcode')); sz:=upper(btrim(p_payload->>'size'));
    select * into gate from hl_order_private.restock_inventory_gates where itemcode=code and size=sz and lot=scope_lot for update;
    select i into item from jsonb_array_elements(items) i where i->>'itemcode'=code and i->>'size'=sz;
    if gate.receipt_watermark is null or p_payload->>'receipt_watermark' is distinct from gate.receipt_watermark::text
      or coalesce((item->>'can_confirm_inventory')::boolean,false) is false then
      raise exception using errcode='55000',message='HL_RESTOCK_CONFIRMATION_STALE'; end if;
    update hl_order_private.restock_inventory_gates set confirmed_watermark=receipt_watermark,confirmed_snapshot=snap,
      confirmed_by=actor,confirmed_at=clock_timestamp() where itemcode=code and size=sz and lot=scope_lot;
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
          join hl_order_private.dispositions x using(source_id) where i.itemcode=code and i.size=sz and i.lot=scope_lot and d.ship_date=day and x.status='draft' order by d.source_id limit 1;
      elsif not exists(select 1 from hl_order_private.restock_intents i join hl_order_private.drafts d using(source_id)
        join hl_order_private.dispositions x using(source_id) where i.source_id=source_id_value and i.itemcode=code and i.size=sz and i.lot=scope_lot and x.status='draft') then
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
        insert into hl_order_private.restock_intents(source_id,itemcode,size,lot,created_by) values(source_id_value,code,sz,scope_lot,actor);
      end if;
      perform hl_order_private.assert_source_unlocked(source_id_value);
      source_value:=jsonb_build_object('source_kind','restock','source_id',source_id_value,'unique_id',source_id_value,
        'itemcode',code,'contsize',sz,'commonname',item->>'commonname','planstartdate',day,'lotcode',scope_lot,'locationcode','',
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


create or replace function hl_order_private.state_json_before_restock()
returns jsonb language sql stable security definer set search_path='' as $function$
  with base as materialized (select hl_order_private.state_json_before_po() s),
  balances as materialized (select * from hl_order_private.po_balances_v2()),
  membership as materialized (select distinct itemcode,lot from balances), adjustments as materialized (
    select a.itemcode,a.size,a.lot,sum(a.quantity_delta) quantity
    from hl_order_private.po_receipt_adjustments a cross join hl_order_private.po_control c
    where a.created_at>c.receipt_cutoff group by a.itemcode,a.size,a.lot
  ), entries as materialized (
    select 'actionable' kind,0::bigint parent,e.ordinality pos,e.value value,e.value source
      from base cross join lateral jsonb_array_elements(s->'actionable_rows') with ordinality e
    union all
    select 'draft',0::bigint,e.ordinality,e.value||jsonb_build_object('po_lot',(select d.po_lot from hl_order_private.drafts d where d.source_id=e.value->>'source_id')),e.value->'source'
      from base cross join lateral jsonb_array_elements(s->'draft') with ordinality e
    union all
    select 'line',o.ordinality,e.ordinality,e.value,e.value->'source'
      from base cross join lateral jsonb_array_elements(s->'orders') with ordinality o
      cross join lateral jsonb_array_elements(o.value->'lines') with ordinality e
  ), enriched as materialized (
    select e.kind,e.parent,e.pos,e.value||jsonb_build_object(
      'po_match',case when e.kind='actionable' then true else m.itemcode is not null end,
      'po_balance',case when b.itemcode is not null then to_jsonb(b)||jsonb_build_object('lot',b.lot)
        else jsonb_build_object('itemcode',upper(btrim(e.source->>'itemcode')),
          'size',upper(btrim(e.source->>'contsize')),'lot',coalesce(e.value->>'po_lot',upper(btrim(e.source->>'lotcode'))),'status','missing',
          'remaining',null,'imported',null,'receipt_adjustment',coalesce(a.quantity,0)) end) value
    from entries e left join balances b on b.itemcode=upper(btrim(e.source->>'itemcode')) and b.size=upper(btrim(e.source->>'contsize')) and b.lot=coalesce(e.value->>'po_lot',upper(btrim(e.source->>'lotcode')))
    left join membership m on m.itemcode=nullif(upper(btrim(e.source->>'itemcode')),'') and m.lot=coalesce(e.value->>'po_lot',upper(btrim(e.source->>'lotcode')))
    left join adjustments a on a.itemcode=upper(btrim(e.source->>'itemcode')) and a.size=upper(btrim(e.source->>'contsize')) and a.lot=coalesce(e.value->>'po_lot',upper(btrim(e.source->>'lotcode')))
  )
  select s||jsonb_build_object(
    'actionable_rows',coalesce((select jsonb_agg(value order by pos) from enriched where kind='actionable'),'[]'::jsonb),
    'draft',coalesce((select jsonb_agg(value order by pos) from enriched where kind='draft'),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(o.value||jsonb_build_object('lines',coalesce(
      (select jsonb_agg(e.value order by e.pos) from enriched e where e.kind='line' and e.parent=o.ordinality),'[]'::jsonb)) order by o.ordinality)
      from jsonb_array_elements(s->'orders') with ordinality o),'[]'::jsonb),
    'po_receipt_cutoff',(select receipt_cutoff from hl_order_private.po_control),
    'po_imports',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'created_at',i.created_at,
      'report_date',i.report_date,'row_count',i.row_count) order by i.created_at desc,i.id desc)
      from hl_order_private.po_imports i where status='pending' and i.source_format='pdf' and i.id=(select id from hl_order_private.po_imports
        where source_format='pdf' and status in ('pending','reconciled') order by (metadata->>'report_printed_at')::timestamptz desc,created_at desc,id desc limit 1)),'[]'::jsonb))
  from base;
$function$;


create function hl_order_private.po_season_command(p_command_id uuid,p_action text,p_payload jsonb,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=hl_order_private.assert_dylan(); rev bigint; request_hash text; saved hl_order_private.commands;
  imp hl_order_private.po_imports; preview hl_order_private.po_import_previews; cutoff timestamptz; result jsonb; rows jsonb; parsed public.ph_27f1_hl_po; row_value jsonb; active_pdf hl_order_private.po_imports;
begin
  if p_action not in ('po_import_preview','po_import_confirm') or p_action is null then
    return hl_order_private.restock_target_command(p_command_id,p_action,p_payload,p_expected_revision);
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
    if imp.source_format<>'pdf' then raise exception 'HL_PO_ORIGINAL_PDF_REQUIRED'; end if;
    if cutoff>clock_timestamp() or cutoff>imp.created_at or cutoff<(select receipt_cutoff from hl_order_private.po_control) then
      raise exception using errcode='22023',message='HL_PO_INVALID_CUTOFF'; end if;
    if imp.id<>(select id from hl_order_private.po_imports where source_format='pdf' and status in ('pending','reconciled') order by (metadata->>'report_printed_at')::timestamptz desc,created_at desc,id desc limit 1) then
      raise exception using errcode='55000',message='HL_PO_IMPORT_SUPERSEDED'; end if;
    select coalesce(jsonb_agg(to_jsonb(b) order by lot,itemcode,size),'[]') into rows from hl_order_private.po_balances_v2(imp.id,cutoff) b;
    insert into hl_order_private.po_import_previews(import_id,created_by,receipt_cutoff,revision,balances)
      values(imp.id,actor,cutoff,rev+1,rows) returning * into preview;
  else
    select * into preview from hl_order_private.po_import_previews where id=(p_payload->>'preview_id')::uuid;
    if not found or preview.created_by<>actor or preview.revision<>rev or preview.expires_at<=clock_timestamp() then
      raise exception using errcode='55000',message='HL_PO_PREVIEW_STALE'; end if;
    select * into imp from hl_order_private.po_imports where id=preview.import_id and status='pending';
    if not found or imp.id<>(select id from hl_order_private.po_imports where source_format='pdf' and status in ('pending','reconciled') order by (metadata->>'report_printed_at')::timestamptz desc,created_at desc,id desc limit 1) then
      raise exception using errcode='55000',message='HL_PO_IMPORT_SUPERSEDED'; end if;
    if preview.receipt_cutoff<(select receipt_cutoff from hl_order_private.po_control) then
      raise exception using errcode='55000',message='HL_PO_PREVIEW_STALE'; end if;
    select i.* into active_pdf from hl_order_private.po_imports i join hl_order_private.po_control c on c.active_import_id=i.id where i.source_format='pdf';
    if active_pdf.id is not null and (imp.metadata->>'report_printed_at')::timestamptz<(active_pdf.metadata->>'report_printed_at')::timestamptz then raise exception 'HL_PO_IMPORT_SUPERSEDED'; end if;
    if exists(select 1 from hl_order_private.po_imports i where i.id<>imp.id and i.source_format='pdf' and i.status in ('pending','reconciled')
      and (i.metadata->>'report_printed_at')::timestamptz=(imp.metadata->>'report_printed_at')::timestamptz and i.fingerprint<>imp.fingerprint) then raise exception 'HL_PO_REPORT_CONFLICT'; end if;
    -- The state lock serializes receipt writes, and this source lock keeps
    -- authoritative source-review reconciliation atomic with report activation.
    lock table public.ph_soc_master in share mode;
    update hl_order_private.po_control set active_scope=imp.id::text,active_import_id=imp.id,receipt_cutoff=preview.receipt_cutoff where singleton;
    update hl_order_private.po_imports set status='reconciled',receipt_cutoff=preview.receipt_cutoff,reconciled_by=actor,reconciled_at=clock_timestamp() where id=imp.id;
    perform hl_order_private.po_refresh_balances();
    with added as (
      insert into hl_order_private.restock_targets(itemcode,size,lot,target,basis_quantity,basis_import_id,created_by)
      select itemcode,size,lot,ceil(remaining*0.30),remaining,imp.id,actor from hl_order_private.po_balances_v2() where status='ready' and remaining>=0
      on conflict(itemcode,size,lot) do nothing returning *
    ) insert into hl_order_private.restock_target_history(target_id,target,basis_quantity,basis_import_id,created_by)
      select id,target,basis_quantity,basis_import_id,created_by from added;
    perform hl_order_private.reconcile();
  end if;
  update hl_order_private.state set revision=revision+1 where singleton;
  insert into hl_order_private.history(command_id,action,payload,created_by) values(p_command_id,p_action,p_payload,actor);
  result:=hl_order_private.state_json();
  if p_action='po_import_preview' then result:=result||jsonb_build_object('po_import_preview',to_jsonb(preview)); end if;
  insert into hl_order_private.commands(command_id,created_by,request_hash,response) values(p_command_id,actor,request_hash,result);
  return result;
end $$;

create function hl_order_private.restock_target_command(p_command_id uuid,p_action text,p_payload jsonb,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=hl_order_private.assert_dylan();rev bigint;hash text;saved hl_order_private.commands;preview hl_order_private.restock_target_previews;
 entry jsonb;scope_lot text;rows jsonb;result jsonb;target_row hl_order_private.restock_targets;imp uuid;
begin
 if p_action not in ('restock_target_preview','restock_target_confirm') then raise exception 'HL_ORDER_INVALID_COMMAND'; end if;
 select revision into rev from hl_order_private.state where singleton for update;
 hash:=hl_order_private.fingerprint(jsonb_build_array(p_action,p_payload,p_expected_revision));
 select * into saved from hl_order_private.commands where command_id=p_command_id;
 if found then if saved.created_by<>actor or saved.request_hash<>hash then raise exception 'HL_ORDER_COMMAND_ID_CONFLICT'; end if; return saved.response; end if;
 if rev<>p_expected_revision then raise exception using errcode='40001',message='HL_ORDER_REVISION_CONFLICT'; end if;
 if app_sync_private.can_read_source('ph_master_inventory') is distinct from true then raise exception 'HL_RESTOCK_INVENTORY_FORBIDDEN'; end if;
 select active_import_id into imp from hl_order_private.po_control;
 if not exists(select 1 from hl_order_private.po_imports where id=imp and source_format='pdf' and status='reconciled') then raise exception 'HL_PO_ORIGINAL_PDF_REQUIRED'; end if;
 if p_action='restock_target_preview' then
  perform hl_order_private.assert_keys(p_payload,array['lot','items']);scope_lot:=p_payload->>'lot';
  if scope_lot is null or scope_lot not in ('27.F1','27.S1') or jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 500 then raise exception 'HL_ORDER_INVALID_COMMAND'; end if;
  rows:='[]';
  for entry in select value from jsonb_array_elements(p_payload->'items') loop
   perform hl_order_private.assert_keys(entry,array['itemcode','size']);
   select to_jsonb(b)||jsonb_build_object('target',ceil(b.remaining*0.30),'basis_quantity',b.remaining,'basis_import_id',imp,'previous_target',t.target)
   into result from hl_order_private.po_balances_v2() b left join hl_order_private.restock_targets t using(itemcode,size,lot)
   where b.itemcode=upper(btrim(entry->>'itemcode')) and b.size=upper(btrim(entry->>'size')) and b.lot=scope_lot and b.status='ready' and b.remaining>=0;
   if result is null then raise exception 'HL_RESTOCK_REVIEW_REQUIRED'; end if;
   if exists(select 1 from jsonb_array_elements(rows) r where r->>'itemcode'=result->>'itemcode' and r->>'size'=result->>'size') then raise exception 'HL_ORDER_INVALID_COMMAND'; end if;
   rows:=rows||jsonb_build_array(result);
  end loop;
  insert into hl_order_private.restock_target_previews(created_by,revision,items) values(actor,rev+1,rows) returning * into preview;
 else
  perform hl_order_private.assert_keys(p_payload,array['preview_id']);
  select * into preview from hl_order_private.restock_target_previews where id=(p_payload->>'preview_id')::uuid;
  if not found or preview.created_by<>actor or preview.revision<>rev or preview.expires_at<=clock_timestamp() then raise exception 'HL_RESTOCK_TARGET_PREVIEW_STALE'; end if;
  for entry in select value from jsonb_array_elements(preview.items) loop
   if entry->>'basis_import_id' is distinct from imp::text then raise exception 'HL_RESTOCK_TARGET_PREVIEW_STALE'; end if;
   insert into hl_order_private.restock_targets(itemcode,size,lot,target,basis_quantity,basis_import_id,created_by)
   values(entry->>'itemcode',entry->>'size',entry->>'lot',(entry->>'target')::numeric,(entry->>'basis_quantity')::numeric,imp,actor)
   on conflict(itemcode,size,lot) do update set target=excluded.target,basis_quantity=excluded.basis_quantity,basis_import_id=excluded.basis_import_id,created_by=excluded.created_by,created_at=clock_timestamp()
   returning * into target_row;
   insert into hl_order_private.restock_target_history(target_id,previous_target,target,basis_quantity,basis_import_id,created_by)
   values(target_row.id,(entry->>'previous_target')::numeric,target_row.target,target_row.basis_quantity,target_row.basis_import_id,actor);
  end loop;
 end if;
 update hl_order_private.state set revision=revision+1 where singleton;
 insert into hl_order_private.history(command_id,action,payload,created_by) values(p_command_id,p_action,p_payload,actor);
 result:=hl_order_private.state_json();
 if p_action='restock_target_preview' then result:=result||jsonb_build_object('restock_target_preview',to_jsonb(preview)); end if;
 insert into hl_order_private.commands(command_id,created_by,request_hash,response) values(p_command_id,actor,hash,result);
 return result;
end $$;

create view public.ph_view_po_27s1_hl with(security_invoker=true) as
with latest as (select run_id from public.ph_27s1_hl_po order by imported_at desc,id desc limit 1),
inventory as(select upper(btrim(itemcode)) itemcode,upper(btrim(contsize)) size,min(commonname) commonname,
 string_agg(distinct locationcode,', ' order by locationcode) locationcode,string_agg(distinct priority,', ' order by priority) priority,
 string_agg(distinct to_jsonb(m)->>'holdstopcode',', ') holdstopcode,string_agg(distinct to_jsonb(m)->>'holdstopreason',', ') holdstopreason,
 sum(case when btrim(to_jsonb(m)->>'ptronhand')~'^-?[0-9]+([.][0-9]+)?$' then (to_jsonb(m)->>'ptronhand')::numeric end) ptronhand
 from public.ph_master_inventory m where upper(btrim(lotcode))='27.S1' group by 1,2),
soc as(select s.*,row_number() over(partition by upper(btrim(itemcode)),upper(btrim(contsize)) order by unique_id) n
 from public.ph_soc_master s where upper(btrim(lotcode))='27.S1' and btrim(coalesce(invoicedate,''))='')
select p.id,p.run_id,p.row_index,p.item_code itemcode,coalesce(i.commonname,p.common_name) commonname,p.size contsize,i.locationcode,i.priority,p.lot lotcode,
i.holdstopcode,i.holdstopreason,p.po_ordered total_quantity_ordered,i.ptronhand,i.ptronhand total_ptronhand,p.lot_pend_rec,
to_jsonb(s)->>'salesrepid' salesrepid,to_jsonb(s)->>'salesrepname' salesrepname,s.customername,s.consigneename,to_jsonb(s)->>'consigneestate' consigneestate,
s.stopnumber,case when btrim(s.quantityordered)~'^-?[0-9]+([.][0-9]+)?$' then s.quantityordered::numeric end quantityordered,
to_jsonb(s)->>'requestdate' requestdate,to_jsonb(s)->>'stagename' stagename,to_jsonb(s)->>'step' step,s.dock,p.po_remain,p.created_at,p.imported_at built_at
from public.ph_27s1_hl_po p join latest l using(run_id) left join inventory i on i.itemcode=upper(btrim(p.item_code)) and i.size=upper(btrim(p.size))
left join soc s on upper(btrim(s.itemcode))=upper(btrim(p.item_code)) and upper(btrim(s.contsize))=upper(btrim(p.size)) and s.n=1;
revoke all on public.ph_view_po_27s1_hl from public,anon,authenticated,service_role;
grant select on public.ph_view_po_27s1_hl to authenticated,service_role;

create or replace view public.ph_view_po_27f1_hl with(security_invoker=true) as
with latest as (select run_id from public.ph_27f1_hl_po order by imported_at desc,id desc limit 1),
inventory as(select upper(btrim(itemcode)) itemcode,upper(btrim(contsize)) size,min(commonname) commonname,
 string_agg(distinct locationcode,', ' order by locationcode) locationcode,string_agg(distinct priority,', ' order by priority) priority,
 string_agg(distinct to_jsonb(m)->>'holdstopcode',', ') holdstopcode,string_agg(distinct to_jsonb(m)->>'holdstopreason',', ') holdstopreason,
 sum(case when btrim(to_jsonb(m)->>'ptronhand')~'^-?[0-9]+([.][0-9]+)?$' then (to_jsonb(m)->>'ptronhand')::numeric end) ptronhand
 from public.ph_master_inventory m where upper(btrim(lotcode))='27.F1' group by 1,2),
soc as(select s.*,row_number() over(partition by upper(btrim(itemcode)),upper(btrim(contsize)) order by unique_id) n
 from public.ph_soc_master s where upper(btrim(lotcode))='27.F1' and btrim(coalesce(invoicedate,''))='')
select p.id,p.run_id,p.row_index,p.item_code itemcode,coalesce(i.commonname,p.common_name) commonname,p.size contsize,i.locationcode,i.priority,p.lot lotcode,
i.holdstopcode,i.holdstopreason,p.po_ordered total_quantity_ordered,i.ptronhand,i.ptronhand total_ptronhand,p.lot_pend_rec,
to_jsonb(s)->>'salesrepid' salesrepid,to_jsonb(s)->>'salesrepname' salesrepname,s.customername,s.consigneename,to_jsonb(s)->>'consigneestate' consigneestate,
s.stopnumber,case when btrim(s.quantityordered)~'^-?[0-9]+([.][0-9]+)?$' then s.quantityordered::numeric end quantityordered,
to_jsonb(s)->>'requestdate' requestdate,to_jsonb(s)->>'stagename' stagename,to_jsonb(s)->>'step' step,s.dock,p.po_remain,p.created_at,p.imported_at built_at
from public.ph_27f1_hl_po p join latest l using(run_id) left join inventory i on i.itemcode=upper(btrim(p.item_code)) and i.size=upper(btrim(p.size))
left join soc s on upper(btrim(s.itemcode))=upper(btrim(p.item_code)) and upper(btrim(s.contsize))=upper(btrim(p.size)) and s.n=1;
revoke all on public.ph_view_po_27f1_hl from public,anon,authenticated,service_role;
grant select on public.ph_view_po_27f1_hl to authenticated,service_role;


-- Revoke every new privileged function explicitly; importer alone can stage.
revoke all on all tables in schema hl_order_private from public,anon,authenticated,service_role;
revoke all on all functions in schema hl_order_private from public,anon,authenticated,service_role;
revoke all on function public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean),public.hl_order_restock_state_v2(text) from public,anon,authenticated,service_role;
grant execute on function public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean) to service_role;
grant execute on function public.hl_order_restock_state_v2(text) to authenticated;
notify pgrst,'reload schema';
commit;
