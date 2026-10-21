begin;
set local lock_timeout='2s';
create or replace function private.inventory_stock_season_v1(p_lot text,p_season text) returns text language sql immutable set search_path='' as $$
 select coalesce(nullif(upper(substring(btrim(coalesce(p_lot,'')) from '(?i)[.]([A-Z][0-9]?)$')),''),upper(btrim(coalesce(p_season,''))))
$$;
create table if not exists app_sync_private.inventory_season_stock_overrides_v1 (
 itemcode text not null,season text not null,open_stock numeric not null,season_oh numeric not null,
 erp_baseline numeric, pending boolean not null default true,cav_acknowledged boolean not null default false,
 updated_by text not null,updated_at timestamptz not null default clock_timestamp(),primary key(itemcode,season)
);
revoke all on app_sync_private.inventory_season_stock_overrides_v1 from public,anon,authenticated;
alter table public.ph_cav_import add column if not exists open_stock text;
alter table public.ph_cav_import add column if not exists season_oh text;

create or replace function private.propagate_inventory_season_stock_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare before_rows jsonb:='[]';after_rows jsonb;change record;baseline numeric;season_total numeric;next_stock numeric;
 actor text:=nullif(current_setting('gnc.inventory_edit_actor',true),'');
begin
 if coalesce(current_setting('gnc.season_stock_sync',true),'')='1' or actor is null or private.ph_master_inventory_import_run_v1() is not null then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(n)),'[]') into after_rows from stock_new n;
 if tg_op='UPDATE' then select coalesce(jsonb_agg(to_jsonb(o)),'[]') into before_rows from stock_old o;end if;
 perform set_config('gnc.season_stock_sync','1',true);
 for change in
   with changes as (
    select value->>'itemcode' itemcode,private.inventory_stock_season_v1(value->>'lotcode',value->>'season') season,
      (case when upper(btrim(coalesce(value->>'holdstopcode',''))) in ('H','S') then 0 else coalesce(private.reclass_numeric_v1(value->>'ptravailable'),0) end)*sign av,
      coalesce(private.reclass_numeric_v1(value->>'ptronhand'),0)*sign oh
    from (select value,1 sign from jsonb_array_elements(after_rows) union all select value,-1 from jsonb_array_elements(before_rows)) r
   ) select itemcode,season,sum(av) delta,sum(oh) oh_delta from changes group by itemcode,season having sum(av)<>0 or sum(oh)<>0 order by itemcode,season
 loop
   perform pg_advisory_xact_lock(hashtextextended('season-stock:'||change.itemcode||':'||change.season,0));
   select o.open_stock into baseline from app_sync_private.inventory_season_stock_overrides_v1 o where o.itemcode=change.itemcode and o.season=change.season and o.pending for update;
   if not found then
    select value into baseline from (
      select private.reclass_numeric_v1(r->>'s_lts') value from (
       select value r from jsonb_array_elements(before_rows)
       union all select to_jsonb(m) from public.ph_master_inventory m where m.itemcode=change.itemcode
        and not exists(select 1 from jsonb_array_elements(after_rows) n where n->>'unique_id'=m.unique_id)
      ) candidates where r->>'itemcode'=change.itemcode and private.inventory_stock_season_v1(r->>'lotcode',r->>'season')=change.season
    ) b where value is not null group by value order by count(*) desc,value desc limit 1;
    if baseline is null then select coalesce(private.reclass_numeric_v1(c.open_stock),private.reclass_numeric_v1(c.ptravailable)) into baseline from public.ph_cav_import c where c.itemcode=change.itemcode and upper(btrim(c.season))=change.season order by c.last_updated desc limit 1;end if;
   end if;
   select coalesce(sum(coalesce(private.reclass_numeric_v1(m.ptronhand),0)),0) into season_total from public.ph_master_inventory m where m.itemcode=change.itemcode and private.inventory_stock_season_v1(m.lotcode,m.season)=change.season;
   next_stock:=coalesce(baseline,0)+change.delta;
   insert into app_sync_private.inventory_season_stock_overrides_v1(itemcode,season,open_stock,season_oh,erp_baseline,updated_by)
    values(change.itemcode,change.season,next_stock,season_total,baseline,actor)
    on conflict(itemcode,season) do update set open_stock=excluded.open_stock,season_oh=excluded.season_oh,pending=true,cav_acknowledged=false,updated_by=actor,updated_at=clock_timestamp();
   update public.ph_master_inventory m set s_lts=next_stock::text,season_oh=season_total::text,last_updated=clock_timestamp()
    where m.itemcode=change.itemcode and private.inventory_stock_season_v1(m.lotcode,m.season)=change.season
      and (m.s_lts is distinct from next_stock::text or m.season_oh is distinct from season_total::text);
   insert into public.ph_cav_import(unique_id,itemcode,commonname,contsize,season,ptravailable,available,open_stock,season_oh,brand,brand_code,spec,hz,last_updated)
    select regexp_replace(concat_ws('-',m.itemcode,coalesce(m.contsize,'-'),coalesce(c.brand_code,c.brand,''),change.season,coalesce(c.spec,''),coalesce(c.hz,'')),'[^a-zA-Z0-9-]','_','g'),
     m.itemcode,m.commonname,m.contsize,change.season,next_stock::text,next_stock::text,next_stock::text,season_total::text,c.brand,c.brand_code,c.spec,c.hz,clock_timestamp()
    from public.ph_master_inventory m left join lateral(select * from public.ph_cav_import x where x.itemcode=m.itemcode order by x.last_updated desc limit 1)c on true
    where m.itemcode=change.itemcode and not exists(select 1 from public.ph_cav_import x where x.itemcode=change.itemcode and upper(btrim(x.season))=change.season)
    order by m.unique_id limit 1 on conflict(unique_id) do nothing;
   update public.ph_cav_import c set ptravailable=next_stock::text,available=next_stock::text,open_stock=next_stock::text,season_oh=season_total::text,last_updated=clock_timestamp()
    where c.itemcode=change.itemcode and upper(btrim(c.season))=change.season;
 end loop;
 perform set_config('gnc.season_stock_sync','',true);return null;
end $$;
drop trigger if exists zz_reclass_season_stock_insert on public.ph_master_inventory;
create trigger zz_reclass_season_stock_insert after insert on public.ph_master_inventory referencing new table as stock_new for each statement execute function private.propagate_inventory_season_stock_v1();
drop trigger if exists zz_reclass_season_stock_update on public.ph_master_inventory;
create trigger zz_reclass_season_stock_update after update on public.ph_master_inventory referencing old table as stock_old new table as stock_new for each statement execute function private.propagate_inventory_season_stock_v1();

-- Retain season-level overrides on future physical rows and CAV imports; only
-- matching fenced ERP evidence may acknowledge the existing per-row ledger.
create or replace function private.guard_inventory_season_stock_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare stock app_sync_private.inventory_season_stock_overrides_v1;raw_value text;raw_row jsonb;context_row app_sync_private.ph_master_bulk_import_context_v1;run_id uuid;
begin
 if tg_op='DELETE' then
  if exists(select 1 from app_sync_private.inventory_season_stock_overrides_v1 s where s.itemcode=old.itemcode and s.season=upper(btrim(old.season)) and s.pending) then return null;end if;
  return old;
 end if;
 if coalesce(current_setting('gnc.season_stock_sync',true),'')='1' then return new;end if;
 select * into stock from app_sync_private.inventory_season_stock_overrides_v1 s where s.itemcode=new.itemcode and s.season=case when tg_table_name='ph_cav_import' then upper(btrim(new.season)) else private.inventory_stock_season_v1(to_jsonb(new)->>'lotcode',new.season) end and s.pending;
 if not found then return new;end if;
 if tg_table_name='ph_cav_import' then
   raw_value:=new.ptravailable;
   if private.reclass_numeric_v1(raw_value)=stock.open_stock then
     update app_sync_private.inventory_season_stock_overrides_v1 set cav_acknowledged=true where itemcode=stock.itemcode and season=stock.season;
   end if;
   new.ptravailable:=stock.open_stock::text;new.available:=stock.open_stock::text;new.open_stock:=stock.open_stock::text;new.season_oh:=stock.season_oh::text;
 else
   run_id:=private.ph_master_inventory_import_run_v1();
   if run_id is null then return new;end if;
   context_row:=private.ph_master_bulk_context_v1(run_id,new.unique_id);raw_row:=context_row.raw_values;
   raw_value:=coalesce(raw_row->>'s_lts',new.s_lts);
   if private.reclass_numeric_v1(raw_value) is distinct from stock.open_stock then
     insert into app_sync_private.inventory_live_overrides_v1 as e(canonical_unique_id,field_name,itemcode,locationcode,lotcode,erp_baseline_value,app_override_value,latest_erp_value,updated_by)
      values(new.unique_id,'s_lts',new.itemcode,new.locationcode,new.lotcode,to_jsonb(raw_value),to_jsonb(stock.open_stock::text),to_jsonb(raw_value),stock.updated_by)
      on conflict(canonical_unique_id,field_name) do update set app_override_value=excluded.app_override_value,pending=true,reconciled_at=null;
   end if;
   new.s_lts:=stock.open_stock::text;new.season_oh:=stock.season_oh::text;
 end if;return new;
end $$;
drop trigger if exists zy_inventory_season_stock_guard on public.ph_master_inventory;
create trigger zy_inventory_season_stock_guard before insert or update on public.ph_master_inventory for each row execute function private.guard_inventory_season_stock_v1();
drop trigger if exists zy_inventory_season_stock_guard on public.ph_cav_import;
create trigger zy_inventory_season_stock_guard before insert or update or delete on public.ph_cav_import for each row execute function private.guard_inventory_season_stock_v1();

-- Pending season protection ends only after both matching CAV evidence and all
-- protected physical-row Open Stock values have acknowledged their ERP values.
create or replace function private.ack_inventory_season_stock_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.ph_master_inventory_import_run_v1() is null or coalesce(current_setting('gnc.season_stock_sync',true),'')='1' then return null;end if;
 update app_sync_private.inventory_season_stock_overrides_v1 s set pending=false,updated_at=clock_timestamp()
 where s.pending and s.cav_acknowledged and not exists(select 1 from app_sync_private.inventory_live_overrides_v1 e where e.itemcode=s.itemcode and e.field_name='s_lts' and e.pending and private.inventory_stock_season_v1(e.lotcode,'')=s.season);
 return null;
end $$;
create trigger zzzz_inventory_season_stock_ack after insert or update on public.ph_master_inventory for each statement execute function private.ack_inventory_season_stock_v1();

alter table app_sync_private.inventory_live_overrides_v1 drop constraint inventory_live_overrides_v1_field_name_check;
alter table app_sync_private.inventory_live_overrides_v1 add constraint inventory_live_overrides_v1_field_name_check check (field_name in ('priority','holdstopcode','holdstopreason','holdstopbegindate','holdstopenddate','ptronhand','ptravailable','ptrreviewed','locationnote','locationptn1','desigitem','desigcust','desigloc','pullerresponsibility','oversellpercentage','salesnote','suspend','spec','caliper','av_note','sales_note','match','loc_match_qty','photo_link','photo_name','pic_note','date_completed','s_lts','season_oh'));

-- Add stock fields to the same durable physical-row import reconciliation.
do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('private.reconcile_inventory_live_overrides_v1()'::regprocedure);
 if position('''s_lts'',''season_oh''' in definition)=0 then
  definition:=replace(definition,'''ptronhand'',''ptravailable'',''ptrreviewed''','''ptronhand'',''ptravailable'',''ptrreviewed'',''s_lts'',''season_oh''');execute definition;
 end if;
 definition:=pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure);
 definition:=replace(definition,$old$actor_key in ('dylan_collyge', 'megan_kelly') then 2 else 3$old$,$new$actor_key in ('dylan_collyge', 'megan_kelly','sharon_combs') then 3 else 4$new$);
 definition:=replace(definition,$old$array['dylan_collyge','megan_kelly',actor_key]$old$,$new$array['dylan_collyge','megan_kelly','sharon_combs',actor_key]$new$);
 definition:=replace(definition,'cardinality(recipients)>3','cardinality(recipients)>4');execute definition;
end $patch$;
revoke all on function private.inventory_stock_season_v1(text,text),private.propagate_inventory_season_stock_v1(),private.guard_inventory_season_stock_v1(),private.ack_inventory_season_stock_v1() from public,anon,authenticated;

create or replace function private.inventory_season_stock_receipt_v1(p_items text[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('itemcode',itemcode,'season',season,'openStock',open_stock,'seasonOnHand',season_oh) order by itemcode,season),'[]') from app_sync_private.inventory_season_stock_overrides_v1 where itemcode=any(p_items) and pending
$$;
revoke all on function private.inventory_season_stock_receipt_v1(text[]) from public,anon,authenticated;
do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure);
 if position('inventory_season_stock_receipt_v1' in definition)=0 then
 definition:=replace(definition,$old$'priority','saleyear'$old$,$new$'saleyear'$new$);
 definition:=replace(definition,$old$  insert into private.ph_inventory_reclass_import_aliases_v1(lineage_key,canonical_unique_id,request_id)$old$,$new$  -- AFTER STATEMENT season propagation has completed; freeze the current rows.
  update pg_temp.reclass_batch_source_json_v1 j set source_after=to_jsonb(m) from public.ph_master_inventory m where m.unique_id=j.source_after->>'unique_id';
  update pg_temp.reclass_batch_target_json_v1 j set destination_after=to_jsonb(m) from public.ph_master_inventory m where m.unique_id=j.destination_after->>'unique_id';
  insert into private.ph_inventory_reclass_import_aliases_v1(lineage_key,canonical_unique_id,request_id)$new$);
 definition:=replace(definition,$old$'rows',result_rows,'movements',result_movements$old$,$new$'seasonStocks',private.inventory_season_stock_receipt_v1(array(select distinct source_after->>'itemcode' from pg_temp.reclass_batch_source_json_v1)),
    'rows',result_rows,'movements',result_movements$new$);execute definition;
 end if;
 definition:=pg_get_functiondef('private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb)'::regprocedure);
 if position('inventory_season_stock_receipt_v1' in definition)=0 then
 definition:=replace(definition,$old$  select r.revision into inventory_revision from public.app_dataset_revisions r where r.key='ph_master_inventory';$old$,$new$  prepared:=jsonb_set(prepared,'{v7FrozenRows}',(select coalesce(jsonb_agg(f.value||jsonb_build_object('s_lts',m.s_lts,'season_oh',m.season_oh)),'[]') from jsonb_array_elements(prepared->'v7FrozenRows') f join public.ph_master_inventory m on m.unique_id=f.value->>'unique_id'));
  select r.revision into inventory_revision from public.app_dataset_revisions r where r.key='ph_master_inventory';$new$);
 definition:=replace(definition,$old$'duplicate',false,'liveEdits',live_rows,'inventoryFields'$old$,$new$'duplicate',false,'seasonStocks',private.inventory_season_stock_receipt_v1(array[source_itemcode]),'liveEdits',live_rows,'inventoryFields'$new$);execute definition;
 end if;
end $patch$;


do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure);
 if position('Freeze all item siblings' in definition)=0 then
 definition:=replace(definition,$old$  event_key_value := 'inventory-reclass-move-completed:' || p_actor_id::text || ':' || p_command_id;
  insert into public.ph_request_delivery_outbox$old$,$new$  -- Freeze all item siblings for the report, including other lot years.
  select jsonb_agg(jsonb_build_object('table','ph_master_inventory','row',to_jsonb(m)) order by m.locationcode,m.lotcode,m.unique_id) into applied_rows
   from public.ph_master_inventory m where m.itemcode in (select r->'row'->>'itemcode' from jsonb_array_elements(applied_rows) r);
  event_key_value := 'inventory-reclass-move-completed:' || p_actor_id::text || ':' || p_command_id;
  insert into public.ph_request_delivery_outbox$new$);execute definition;
 end if;
end $patch$;

do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)'::regprocedure);
 definition:=replace(definition,$old$'appliedRows', receipt.result->'rows'$old$,$new$'appliedRows', coalesce(payload_value->'appliedRows',receipt.result->'rows')$new$);execute definition;
end $patch$;

-- Authorized repair of the already committed Flame Grass move; no movement is replayed.
do $repair$ begin
 if (select count(*) from public.ph_master_inventory where itemcode='004502.010.1' and
  ((locationcode='C.16.000' and lotcode='27.S1' and private.reclass_numeric_v1(ptronhand)=295 and private.reclass_numeric_v1(ptravailable)=295)
   or(locationcode='C.16.000' and lotcode='27.F1' and private.reclass_numeric_v1(ptronhand)=200 and private.reclass_numeric_v1(ptravailable)=200)
   or(locationcode='F.19.000' and lotcode='27.F1' and private.reclass_numeric_v1(ptronhand)=189 and private.reclass_numeric_v1(ptravailable)=152)
   or(locationcode='H.06.000' and lotcode='27.F1' and private.reclass_numeric_v1(ptronhand)=228 and private.reclass_numeric_v1(ptravailable)=228)
   or(locationcode='C.17.000' and lotcode='26.F1' and private.reclass_numeric_v1(ptronhand)=17 and private.reclass_numeric_v1(ptravailable)=17)))<>5 then
   raise exception 'FLAME_GRASS_REPAIR_SOURCE_CHANGED';
 end if;
 perform set_config('gnc.inventory_edit_actor','dylan_collyge',true);
 perform set_config('gnc.season_stock_sync','1',true);
 insert into app_sync_private.inventory_season_stock_overrides_v1(itemcode,season,open_stock,season_oh,erp_baseline,updated_by)
 values('004502.010.1','F1',577,634,377,'dylan_collyge'),('004502.010.1','S1',585,295,785,'dylan_collyge')
 on conflict(itemcode,season) do update set open_stock=excluded.open_stock,season_oh=excluded.season_oh,pending=true,cav_acknowledged=false,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 update public.ph_master_inventory m set s_lts=s.open_stock::text,season_oh=s.season_oh::text,ptrreviewed=coalesce(nullif(m.ptrreviewed,''),'0'),
  priority=case when m.locationcode='C.16.000' and m.lotcode='27.S1' then '1' when m.locationcode='F.19.000' and m.lotcode='27.F1' then '10' when m.locationcode='C.16.000' and m.lotcode='27.F1' then null else m.priority end,last_updated=clock_timestamp()
 from app_sync_private.inventory_season_stock_overrides_v1 s where m.itemcode='004502.010.1' and m.itemcode=s.itemcode and private.inventory_stock_season_v1(m.lotcode,m.season)=s.season;
 update public.ph_cav_import c set ptravailable=s.open_stock::text,available=s.open_stock::text,open_stock=s.open_stock::text,season_oh=s.season_oh::text,last_updated=clock_timestamp()
 from app_sync_private.inventory_season_stock_overrides_v1 s where c.itemcode='004502.010.1' and c.itemcode=s.itemcode and upper(btrim(c.season))=s.season;
 perform set_config('gnc.season_stock_sync','',true);perform set_config('gnc.inventory_edit_actor','',true);
 -- Existing statement triggers advance master/CAV revisions atomically.
end $repair$;

notify pgrst,'reload schema';
commit;
