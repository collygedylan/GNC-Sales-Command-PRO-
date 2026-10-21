begin;

alter table public.app_dataset_revisions
  add column if not exists source_file_name text,
  add column if not exists source_file_id text,
  add column if not exists source_imported_at timestamptz,
  add column if not exists source_import_run_id uuid;

-- Existing workers can finish between SQL and Apps Script publication. Their
-- completion RPC must also stamp committed-row evidence before acknowledging
-- archive eligibility; the new RPC below supplies the pinned exact file ID/name.
create or replace function public.finish_dataset_import_v1(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; run app_sync_private.import_runs%rowtype; dataset text; filename text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='IMPORT_SOURCE_METADATA_FORBIDDEN';
  end if;
  result := app_sync_private.advance_import(p_run_id,'finish');
  if (result->>'ok')::boolean is distinct from true then return result; end if;
  select * into run from app_sync_private.import_runs where id=p_run_id;
  foreach dataset in array run.canonical_keys loop
    if dataset=any(array['ph_master_inventory','ph_soc_master','ph_reserves','ph_cav_import']) then
      if exists(select 1 from app_sync_private.import_runs newer where newer.id<>p_run_id
        and newer.created_at>run.created_at and dataset=any(newer.canonical_keys)) then
        raise exception using errcode='55000',message='IMPORT_SOURCE_FINISH_SUPERSEDED';
      end if;
      execute format('select filename from public.%I where nullif(btrim(filename),'''') is not null
        and last_updated is not null order by last_updated desc,filename desc limit 1',dataset) into filename;
      if filename is not null then
        update public.app_dataset_revisions r set source_file_id=case when r.source_file_name=filename then r.source_file_id else null end,
          source_file_name=filename,source_imported_at=r.changed_at,source_import_run_id=p_run_id
        where r.key=dataset and r.state='ready';
        if not found then raise exception using errcode='55000',message='IMPORT_SOURCE_REVISION_NOT_READY'; end if;
      end if;
    end if;
  end loop;
  return result;
end;$$;
revoke all on function public.finish_dataset_import_v1(uuid) from public,anon,authenticated;
grant execute on function public.finish_dataset_import_v1(uuid) to service_role;

-- Completion and source metadata are one transaction. Apps Script must receive
-- this acknowledgement before moving the pinned input file to Processed.
create or replace function public.finish_dataset_import_with_sources_v1(p_run_id uuid, p_sources jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run app_sync_private.import_runs%rowtype; source jsonb; result jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='IMPORT_SOURCE_METADATA_FORBIDDEN';
  end if;
  if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 32 then
    raise exception using errcode='22023',message='IMPORT_SOURCE_METADATA_INVALID';
  end if;
  select * into run from app_sync_private.import_runs where id=p_run_id for update;
  if not found or run.state not in ('active','completed') then
    raise exception using errcode='55000',message='IMPORT_SOURCE_RUN_NOT_ACTIVE';
  end if;
  if exists(select 1 from jsonb_array_elements(p_sources) s group by s->>'key' having count(*)>1) then
    raise exception using errcode='22023',message='IMPORT_SOURCE_DUPLICATE_KEY';
  end if;
  for source in select value from jsonb_array_elements(p_sources) loop
    if coalesce(source->>'key','') = '' or not (source->>'key'=any(run.source_keys))
      or nullif(btrim(source->>'fileName'),'') is null
      or nullif(btrim(source->>'fileId'),'') is null then
      raise exception using errcode='22023',message='IMPORT_SOURCE_METADATA_INVALID';
    end if;
  end loop;
  if run.state='completed' then
    if exists(select 1 from jsonb_array_elements(p_sources) s
      where not exists(select 1 from public.app_dataset_revisions r where r.key=s->>'key'
        and r.source_import_run_id=p_run_id and r.source_file_name=s->>'fileName' and r.source_file_id=s->>'fileId')) then
      raise exception using errcode='55000',message='IMPORT_SOURCE_REPLAY_SUPERSEDED';
    end if;
    return jsonb_build_object('ok',true,'sourceMetadataStamped',true,'replayed',true);
  end if;
  result := public.finish_dataset_import_v1(p_run_id);
  if (result->>'ok')::boolean is distinct from true then
    raise exception using errcode='55000',message='IMPORT_SOURCE_COMPLETION_FAILED';
  end if;
  for source in select value from jsonb_array_elements(p_sources) loop
    update public.app_dataset_revisions
    set source_file_name=source->>'fileName',source_file_id=source->>'fileId',source_imported_at=changed_at,source_import_run_id=p_run_id
    where key=source->>'key' and state='ready';
    if not found then raise exception using errcode='55000',message='IMPORT_SOURCE_REVISION_NOT_READY'; end if;
  end loop;
  return result || jsonb_build_object('sourceMetadataStamped',true);
end;$$;
revoke all on function public.finish_dataset_import_with_sources_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_dataset_import_with_sources_v1(uuid,jsonb) to service_role;

-- Existing filenames remain evidence of the last committed rows, even where
-- a newer pending import is interrupted. Do not rewrite inventory rows.
do $$ declare dataset text; begin
  foreach dataset in array array['ph_master_inventory','ph_soc_master','ph_reserves','ph_cav_import'] loop
    execute format('update public.app_dataset_revisions r set source_file_name=s.filename,source_imported_at=s.last_updated
      from (select filename,last_updated from public.%I where nullif(btrim(filename),'''') is not null
        and last_updated is not null order by last_updated desc,filename desc limit 1) s
      where r.key=%L and r.source_file_name is null',dataset,dataset);
  end loop;
end;$$;

-- Extend the existing permission-filtered snapshot; never expose metadata for
-- a dataset the current actor cannot read.
do $$ declare definition text; decorated text;
  original constant text := '''changedAt'',case when allowed then r.changed_at else null end,'; begin
  definition := pg_get_functiondef('app_sync_private.snapshot(text[])'::regprocedure);
  decorated := original || E'\n    ''sourceFileName'',case when allowed then r.source_file_name else null end,\n    ''sourceFileId'',case when allowed then r.source_file_id else null end,\n    ''sourceImportedAt'',case when allowed then r.source_imported_at else null end,';
  if position(decorated in definition)=0 then
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'IMPORT_METADATA_SNAPSHOT_CONTRACT_CHANGED';
    end if;
    execute replace(definition,original,decorated);
  end if;
end;$$;

notify pgrst,'reload schema';
commit;
