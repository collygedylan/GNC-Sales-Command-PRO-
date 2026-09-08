-- Statement triggers also fire when INSERT/UPDATE/DELETE affect zero rows.
-- Keep import-token validation, but advertise only actual source writes.
-- No source rows, revisions, grants, policies or import leases are rewritten.
create or replace function app_sync_private.touch_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_key text := case when tg_table_schema='public' then tg_table_name else tg_table_schema||'.'||tg_table_name end;
  header_run text; run app_sync_private.import_runs; touched jsonb; has_rows boolean;
  current_revision public.app_dataset_revisions;
begin
  if tg_op in ('INSERT','UPDATE') then
    select exists(select 1 from app_dataset_new_rows) into has_rows;
  elsif tg_op='DELETE' then
    select exists(select 1 from app_dataset_old_rows) into has_rows;
  elsif tg_op='TRUNCATE' then
    -- TRUNCATE has no transition relation; preserve its existing invalidation.
    has_rows := true;
  else
    raise exception using errcode='55000',message='DATASET_SOURCE_OPERATION_INVALID';
  end if;
  touched := coalesce(nullif(current_setting('app_sync.touched',true),'')::jsonb,'{}'::jsonb);
  -- Retain the real-write transaction fast path. An empty statement must still
  -- validate its token, including after another statement touched the source.
  if has_rows and touched ? source_key then return null; end if;
  select * into current_revision from public.app_dataset_revisions where key=source_key for update;
  if not found then raise exception using errcode='55000',message='DATASET_SOURCE_UNREGISTERED'; end if;
  header_run := nullif(current_setting('request.headers',true),'')::jsonb->>'x-gnc-import-run-id';
  if header_run is not null then
    select * into run from app_sync_private.import_runs where id::text=header_run;
    if run.id is null then raise exception using errcode='55000',message='DATASET_IMPORT_TOKEN_INVALID'; end if;
    if run.state<>'active' or run.expires_at<=clock_timestamp() then
      raise exception using errcode='55000',message='DATASET_IMPORT_FENCE_LOST';
    end if;
    if source_key=any(run.source_keys) and not exists(
      select 1 from app_sync_private.import_leases where key=source_key and run_id=run.id) then
      raise exception using errcode='55000',message='DATASET_IMPORT_FENCE_LOST';
    end if;
  end if;
  -- Do not mark an empty source touched: a later real write in this transaction
  -- must still acquire its revision. UPDATE of existing rows remains a change,
  -- even if the assigned values equal their previous values.
  if not has_rows then return null; end if;
  perform set_config('app_sync.touched',(touched||jsonb_build_object(source_key,true))::text,true);
  if current_revision.state='importing' then
    -- Keep the revision lock until commit; finish cannot publish ready ahead
    -- of a concurrent, already-acknowledged source write.
    return null;
  end if;
  update public.app_dataset_revisions set revision=revision+1,changed_at=clock_timestamp() where key=source_key;
  return null;
end $$;

do $$ declare source record; begin
  for source in select s.key,n.nspname,c.relname from app_sync_private.sources s
    join public.app_dataset_revisions r on r.key=s.key
    join pg_catalog.pg_class c on c.relname=case when position('.' in s.key)>0 then split_part(s.key,'.',2) else s.key end
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname=case when position('.' in s.key)>0 then split_part(s.key,'.',1) else 'public' end
      and c.relkind in ('r','p') order by s.key loop
    execute format('drop trigger app_dataset_revision_changed on %I.%I',source.nspname,source.relname);
    -- PostgreSQL requires one event per trigger when using transition tables.
    -- Leave every existing business trigger untouched.
    execute format('create trigger app_dataset_revision_inserted after insert on %I.%I referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source()',source.nspname,source.relname);
    execute format('create trigger app_dataset_revision_updated after update on %I.%I referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source()',source.nspname,source.relname);
    execute format('create trigger app_dataset_revision_deleted after delete on %I.%I referencing old table as app_dataset_old_rows for each statement execute function app_sync_private.touch_source()',source.nspname,source.relname);
    execute format('create trigger app_dataset_revision_truncated after truncate on %I.%I for each statement execute function app_sync_private.touch_source()',source.nspname,source.relname);
  end loop;
end $$;
