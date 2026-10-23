begin;

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
   update public.ph_master_inventory m set
    s_lts=case when change.delta<>0 and private.reclass_numeric_v1(m.s_lts) is not null then (private.reclass_numeric_v1(m.s_lts)+change.delta)::text else m.s_lts end,
    season_oh=season_total::text,last_updated=clock_timestamp()
    where m.itemcode=change.itemcode and private.inventory_stock_season_v1(m.lotcode,m.season)=change.season
      and (change.delta<>0 or m.season_oh is distinct from season_total::text);
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

create or replace function private.guard_inventory_season_stock_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare stock app_sync_private.inventory_season_stock_overrides_v1;raw_value text;
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
   if private.reclass_numeric_v1(raw_value)=stock.open_stock then update app_sync_private.inventory_season_stock_overrides_v1 set cav_acknowledged=true where itemcode=stock.itemcode and season=stock.season;end if;
   new.ptravailable:=stock.open_stock::text;new.available:=stock.open_stock::text;new.open_stock:=stock.open_stock::text;new.season_oh:=stock.season_oh::text;
 elsif private.ph_master_inventory_import_run_v1() is not null then
   new.season_oh:=stock.season_oh::text;
 end if;return new;
end $$;

create or replace function private.inventory_season_stock_receipt_v1(p_items text[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'itemcode',s.itemcode,'season',s.season,'openStock',s.open_stock,'seasonOnHand',s.season_oh,
   'rows',(select coalesce(jsonb_agg(jsonb_build_object('uniqueId',m.unique_id,'openStock',m.s_lts) order by m.unique_id),'[]')
     from public.ph_master_inventory m where m.itemcode=s.itemcode and private.inventory_stock_season_v1(m.lotcode,m.season)=s.season)
 ) order by s.itemcode,s.season),'[]') from app_sync_private.inventory_season_stock_overrides_v1 s where s.itemcode=any(p_items) and s.pending
$$;

do $repair$ begin
 if exists(select 1 from public.ph_master_inventory where itemcode='010018.031.1' and locationcode='A.03.000' and lotcode='27.S1' and private.reclass_numeric_v1(ptronhand)=275)
  and exists(select 1 from public.ph_master_inventory where itemcode='010018.031.1' and locationcode='A.03.000' and lotcode='27.F1' and private.reclass_numeric_v1(ptronhand)=169 and private.reclass_numeric_v1(ptravailable)=159 and private.reclass_numeric_v1(s_lts)=430) then
   perform set_config('gnc.inventory_edit_actor','system:v2.3.50',true);perform set_config('gnc.season_stock_sync','1',true);
   update public.ph_master_inventory set s_lts='159',last_updated=clock_timestamp() where itemcode='010018.031.1' and locationcode='A.03.000' and lotcode='27.F1';
   perform set_config('gnc.season_stock_sync','',true);perform set_config('gnc.inventory_edit_actor','',true);
 end if;
end $repair$;

revoke all on function private.propagate_inventory_season_stock_v1(),private.guard_inventory_season_stock_v1(),private.inventory_season_stock_receipt_v1(text[]) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
