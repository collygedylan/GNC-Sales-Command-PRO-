begin;
set local lock_timeout = '1500ms';
set local statement_timeout = '120s';

-- Normalize only public Storage URLs; retain unrelated query parameters and JSON types.
create or replace function private.normalize_storage_public_url_v23130(value text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare base text; query text; kept text;
begin
  if value is null or value !~ '/storage/v1/(render/image|object)/public/' then return value; end if;
  base := replace(split_part(value, '?', 1), '/storage/v1/render/image/public/', '/storage/v1/object/public/');
  if position('?' in value) = 0 then return base; end if;
  query := substring(value from position('?' in value) + 1);
  select string_agg(part, '&' order by ordinal) into kept
  from unnest(string_to_array(query, '&')) with ordinality as q(part, ordinal)
  where lower(split_part(part, '=', 1)) not in ('width','height','resize','quality','format');
  return base || case when coalesce(kept, '') = '' then '' else '?' || kept end;
end $$;

create or replace function private.normalize_photo_json_v23130(value jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare result jsonb;
begin
  case jsonb_typeof(value)
    when 'string' then return to_jsonb(private.normalize_storage_public_url_v23130(value #>> '{}'));
    when 'array' then
      select coalesce(jsonb_agg(private.normalize_photo_json_v23130(v) order by ordinal), '[]'::jsonb)
        into result from jsonb_array_elements(value) with ordinality as a(v, ordinal);
    when 'object' then
      select coalesce(jsonb_object_agg(k, private.normalize_photo_json_v23130(v)), '{}'::jsonb)
        into result from jsonb_each(value) as o(k,v);
    else return value;
  end case;
  return result;
end $$;
revoke all on function private.normalize_storage_public_url_v23130(text), private.normalize_photo_json_v23130(jsonb) from public, anon, authenticated;

do $photos$
declare col record; normalizer text;
begin
  for col in
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c join pg_class t on t.relname=c.table_name
      join pg_namespace n on n.oid=t.relnamespace and n.nspname=c.table_schema
    where c.table_schema='public' and t.relkind in ('r','p')
      and c.table_name in ('ph_master_inventory','ph_location_sales_notes','ph_active_requests',
        'ph_requests_pending','ph_request_history','ph_active_suspend','ph_suspend_history',
        'ph_flyer_folders','ph_flyer_folder_items','ph_eval_work','ph_soc_master','inventory_projects','inventory_project_rows')
      and (c.data_type='jsonb' or (c.data_type in ('text','character varying') and c.column_name ~ '(photo|image|evidence)'))
  loop
    normalizer := case when col.data_type='jsonb' then 'normalize_photo_json_v23130' else 'normalize_storage_public_url_v23130' end;
    execute format('update public.%I set %I=private.%I(%I) where %I::text like %L and %I is distinct from private.%I(%I)',
      col.table_name,col.column_name,normalizer,col.column_name,col.column_name,'%/storage/v1/%/public/%',col.column_name,normalizer,col.column_name);
  end loop;
end $photos$;

create or replace function public.ph_prune_supabase_bloat_v1()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare affected bigint; results jsonb := '{}'::jsonb; fk record; guards text := ''; target text;
begin
  perform pg_advisory_xact_lock(hashtext('ph_prune_supabase_bloat_v1'));
  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details where end_time < now() - interval ''3 days''';
    get diagnostics affected = row_count; results := results || jsonb_build_object('cron',affected);
  end if;
  -- Legacy run summaries are not the private resumable ERP jobs. Never fabricate success.
  if to_regclass('public.ph_erp_sync_runs') is not null then
    execute 'update public.ph_erp_sync_runs set status=''failed'' where status=''running'' and updated_at < now()-interval ''90 seconds''';
    execute 'delete from public.ph_erp_sync_runs where status in (''completed'',''complete'') and updated_at < now()-interval ''14 days'' and id not in (select id from public.ph_erp_sync_runs order by updated_at desc limit 50)';
    get diagnostics affected = row_count; results := results || jsonb_build_object('legacy_runs',affected);
  end if;
  foreach target in array array['ph_runtime_watchdog_events','app_runtime_watchdog_events','ph_watchdog_events'] loop
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=target and column_name='created_at' and data_type in ('timestamp with time zone','timestamp without time zone')) then
      execute format('delete from public.%I where created_at < now()-interval ''7 days''',target);
      get diagnostics affected = row_count; results := results || jsonb_build_object(target,affected);
    end if;
  end loop;
  -- Keep every referenced delivery receipt and every active lease; never cascade into crew/history records.
  for fk in select ns.nspname, t.relname, a.attname
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace ns on ns.oid=t.relnamespace
      join pg_attribute a on a.attrelid=t.oid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='public.ph_request_delivery_outbox'::regclass
  loop
    guards := guards || format(' and not exists(select 1 from %I.%I r where r.%I=o.event_id)',fk.nspname,fk.relname,fk.attname);
  end loop;
  execute 'delete from public.ph_request_delivery_outbox o where status=''delivered'' and delivered_at < now()-interval ''14 days'' and (lease_expires_at is null or lease_expires_at < now())' || guards;
  get diagnostics affected = row_count;
  return results || jsonb_build_object('delivered_outbox',affected);
end $$;
revoke all on function public.ph_prune_supabase_bloat_v1() from public, anon, authenticated;
grant execute on function public.ph_prune_supabase_bloat_v1() to service_role;
select public.ph_prune_supabase_bloat_v1();

do $rls$
declare t record;
begin
  for t in select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
  loop
    execute format('alter table public.%I enable row level security',t.relname);
    if not t.relrowsecurity or t.relname='ph_00_table_directory' then
      -- Policies never grant table privileges; protected credential/outbox tables retain their existing policies.
      if t.relname not in ('ph_app_users','user_access_control','ph_request_delivery_outbox')
        and has_table_privilege('anon',format('public.%I',t.relname),'SELECT')
        and has_table_privilege('authenticated',format('public.%I',t.relname),'SELECT') then
        execute format('drop policy if exists quota_public_read_v23130 on public.%I',t.relname);
        execute format('create policy quota_public_read_v23130 on public.%I for select to anon, authenticated using (true)',t.relname);
      end if;
      execute format('drop policy if exists quota_service_v23130 on public.%I',t.relname);
      execute format('create policy quota_service_v23130 on public.%I for all to service_role using (true) with check (true)',t.relname);
    end if;
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v'
  loop
    execute format('alter view public.%I set (security_invoker = true)',t.relname);
  end loop;
end $rls$;
commit;
