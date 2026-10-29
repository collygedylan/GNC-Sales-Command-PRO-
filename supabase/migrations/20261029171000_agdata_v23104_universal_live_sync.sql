begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- The operational row stream remains Postgres Changes, which applies each
-- subscriber's existing table RLS. Broadcast row payloads are server-only and
-- limited to operational sources with an existing uniform SELECT policy.
create or replace function public.agdata_live_sync_authorized_v23104()
returns boolean language sql stable security definer set search_path='' as $$
  select app_sync_private.active_actor() is not null
$$;
revoke all on function public.agdata_live_sync_authorized_v23104() from public,anon;
grant execute on function public.agdata_live_sync_authorized_v23104() to authenticated;

drop policy if exists agdata_live_sync_receive_v23104 on realtime.messages;
create policy agdata_live_sync_receive_v23104 on realtime.messages for select to authenticated
using ((select realtime.topic())='agdata-live-sync'
  and (select public.agdata_live_sync_authorized_v23104()));
drop policy if exists agdata_live_sync_hint_v23104 on realtime.messages;
create policy agdata_live_sync_hint_v23104 on realtime.messages as restrictive for insert to authenticated
with check ((select realtime.topic())<>'agdata-live-sync');

create or replace function app_sync_private.broadcast_rows_v23104()
returns trigger language plpgsql security definer set search_path='' as $$
declare rows_value jsonb; payload jsonb;
begin
  if tg_table_schema<>'public' or tg_table_name<>all(array['ph_master_inventory','ph_location_sales_notes',
    'ph_soc_master','ph_requests_pending','ph_requests_completed_history','ph_reserves']) then return null; end if;
  -- A later policy tightening automatically falls back to per-user Postgres Changes.
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=tg_table_name
    and cmd in('SELECT','ALL') and permissive='PERMISSIVE' and qual='true'
    and roles && array['public','authenticated']::name[]) then return null; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename=tg_table_name
    and cmd in('SELECT','ALL') and permissive='RESTRICTIVE'
    and roles && array['public','authenticated']::name[]) then return null; end if;
  if tg_op='DELETE' then
    select jsonb_agg(to_jsonb(r)) into rows_value from (select * from agdata_live_old_rows limit 17) r;
  else
    select jsonb_agg(to_jsonb(r)) into rows_value from (select * from agdata_live_new_rows limit 17) r;
  end if;
  if rows_value is null or jsonb_array_length(rows_value)>16 then return null; end if;
  payload:=jsonb_build_object('table',tg_table_name,'eventType',tg_op,'rows',rows_value);
  if octet_length(payload::text)>65536 then return null; end if;
  begin
    perform realtime.send(payload,'row_patch','agdata-live-sync',true);
  exception when others then raise log 'AgData row broadcast unavailable: %',sqlstate;
  end;
  return null;
end $$;
revoke all on function app_sync_private.broadcast_rows_v23104() from public,anon,authenticated;

do $row_broadcast$
declare table_name text; relation regclass; op text; trigger_name text;
begin
  foreach table_name in array array['ph_master_inventory','ph_location_sales_notes','ph_soc_master',
    'ph_requests_pending','ph_requests_completed_history','ph_reserves'] loop
    relation:=to_regclass('public.'||quote_ident(table_name));
    if relation is null then continue; end if;
    foreach op in array array['INSERT','UPDATE','DELETE'] loop
      trigger_name:='agdata_live_'||lower(op)||'_v23104';
      if exists(select 1 from pg_trigger where tgrelid=relation and tgname=trigger_name) then continue; end if;
      execute format('create trigger %I after %s on %s referencing %s table as %I for each statement execute function app_sync_private.broadcast_rows_v23104()',
        trigger_name,op,relation,case when op='DELETE' then 'old' else 'new' end,
        case when op='DELETE' then 'agdata_live_old_rows' else 'agdata_live_new_rows' end);
    end loop;
  end loop;
end $row_broadcast$;

create or replace function app_sync_private.broadcast_revision_v23104()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.revision is not distinct from old.revision
    and new.state is not distinct from old.state then return new; end if;
  begin
    perform realtime.send(jsonb_build_object('key',new.key,'revision',new.revision::text,
      'state',new.state,'changedAt',new.changed_at),'dataset_change','agdata-live-sync',true);
  exception when others then
    -- A transport outage cannot roll back an otherwise valid business write.
    -- The durable revision and RLS-filtered Postgres Changes remain available.
    raise log 'AgData realtime hint unavailable: %',sqlstate;
  end;
  return new;
end $$;
revoke all on function app_sync_private.broadcast_revision_v23104() from public,anon,authenticated;
drop trigger if exists agdata_broadcast_revision_v23104 on public.app_dataset_revisions;
create trigger agdata_broadcast_revision_v23104 after insert or update on public.app_dataset_revisions
for each row execute function app_sync_private.broadcast_revision_v23104();

-- Register the shared note source with the same read modules as its inventory
-- owner. All remaining source/module/access contracts stay canonical.
insert into app_sync_private.sources(key,modules,client_enabled,dylan_only)
select 'ph_location_sales_notes',modules,client_enabled,dylan_only
from app_sync_private.sources where key='ph_master_inventory'
  and to_regclass('public.ph_location_sales_notes') is not null
on conflict(key) do nothing;
insert into public.app_dataset_revisions(key)
select key from app_sync_private.sources where key='ph_location_sales_notes'
on conflict(key) do nothing;

-- Cover registered writable sources which predate revision wiring. Reuse the
-- canonical statement-level fence, no per-row master trigger or competing bump.
do $install$
declare source record; relation regclass; op text; op_bit integer; trigger_name text;
begin
  for source in select key from app_sync_private.sources
    where client_enabled and key<>'app_dataset_revisions' order by key loop
    relation:=to_regclass(case when position('.' in source.key)>0 then source.key
      else 'public.'||quote_ident(source.key) end);
    if relation is null or not exists(select 1 from pg_class where oid=relation and relkind in('r','p')) then continue; end if;
    insert into public.app_dataset_revisions(key) values(source.key) on conflict(key) do nothing;
    foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      op_bit:=case op when 'INSERT' then 4 when 'UPDATE' then 16 when 'DELETE' then 8 else 32 end;
      if exists(select 1 from pg_trigger where tgrelid=relation and not tgisinternal
        and tgfoid='app_sync_private.touch_source()'::regprocedure and (tgtype::int & op_bit)<>0) then continue; end if;
      trigger_name:='agdata_revision_'||lower(op)||'_v23104';
      if exists(select 1 from pg_trigger where tgrelid=relation and tgname=trigger_name) then continue; end if;
      execute format('create trigger %I after %s on %s %s for each statement execute function app_sync_private.touch_source()',
        trigger_name,op,relation,case when op in('INSERT','UPDATE') then 'referencing new table as app_dataset_new_rows'
          when op='DELETE' then 'referencing old table as app_dataset_old_rows' else '' end);
    end loop;
  end loop;
end $install$;

-- A view cannot publish WAL row changes. Suspend derives from SOC; pending and
-- completed Requests use their real base relations. Never publish credential tables.
do $publication$
declare table_name text; relation regclass;
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then return; end if;
  foreach table_name in array array['app_dataset_revisions','ph_master_inventory','ph_location_sales_notes',
    'ph_soc_master','ph_requests_pending','ph_requests_completed_history','ph_reserves',
    'ph_warehouse_assigned_items','ph_inventory_row_assignments'] loop
    relation:=to_regclass('public.'||quote_ident(table_name));
    if relation is not null and exists(select 1 from pg_class where oid=relation and relkind in('r','p'))
      and not exists(select 1 from pg_publication_rel r join pg_publication p on p.oid=r.prpubid
        where p.pubname='supabase_realtime' and r.prrelid=relation) then
      execute format('alter publication supabase_realtime add table %s',relation);
    end if;
  end loop;
end $publication$;
notify pgrst,'reload schema';
commit;
