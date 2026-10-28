begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

-- Streaming sources declare a bounded capacity, then seal their exact row count
-- at EOF. Fixed-count callers retain the original strict count contract.
do $$
declare definition text := pg_get_functiondef('public.fast_begin_erp_stage_v1(text,jsonb,integer)'::regprocedure);
begin
  if position('expected_rows_pending' in definition)=0 then
    if position('meta:=private.fast_erp_file_meta_v2369(p_file_meta);' in definition)=0
      or position('elsif stage.expected_rows<>p_expected_rows or stage.file_meta is distinct from meta then' in definition)=0 then
      raise exception 'ERP_SYNC_BEGIN_CONTRACT_CHANGED';
    end if;
    definition := replace(definition,'meta:=private.fast_erp_file_meta_v2369(p_file_meta);',
      'meta:=private.fast_erp_file_meta_v2369(p_file_meta);
       if p_file_meta->>''expected_rows_pending'' = ''true'' then
         if p_expected_rows<>50000 then raise exception ''FAST_ERP_STAGE_CAPACITY_INVALID''; end if;
         meta:=meta||jsonb_build_object(''expected_rows_pending'',true);
       end if;');
    definition := replace(definition,
      'elsif stage.expected_rows<>p_expected_rows or stage.file_meta is distinct from meta then',
      'elsif (stage.expected_rows<>p_expected_rows and coalesce(meta->>''expected_rows_pending'',''false'')<>''true'') or stage.file_meta is distinct from meta then');
    execute definition;
  end if;
end;
$$;

create or replace function public.fast_seal_erp_stage_v1(p_stage_id uuid,p_expected_rows integer)
returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='5s' set lock_timeout='1s' as $$
declare stage private.fast_erp_stage_runs_v1%rowtype; actual_rows integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN'; end if;
  if p_stage_id is null or p_expected_rows is null or p_expected_rows<1 or p_expected_rows>50000 then
    raise exception 'FAST_ERP_STAGE_COUNT_INVALID';
  end if;
  select * into stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id for update;
  if not found or stage.stage_state not in ('staging','committed') or stage.expires_at<=clock_timestamp()
    or stage.file_meta->>'expected_rows_pending' is distinct from 'true'
    or stage.staged_rows<>p_expected_rows or stage.expected_rows<p_expected_rows then
    raise exception 'FAST_ERP_STAGE_COUNT_MISMATCH';
  end if;
  select count(*) into actual_rows from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;
  if actual_rows<>p_expected_rows then raise exception 'FAST_ERP_STAGE_COUNT_MISMATCH'; end if;
  if stage.stage_state='committed' and stage.expected_rows<>p_expected_rows then
    raise exception 'FAST_ERP_STAGE_COUNT_MISMATCH';
  end if;
  update private.fast_erp_stage_runs_v1 set expected_rows=p_expected_rows where stage_id=p_stage_id;
  return jsonb_build_object('ok',true,'stage_id',p_stage_id,'expected_rows',p_expected_rows,'staged_rows',actual_rows);
end;
$$;
revoke all on function public.fast_seal_erp_stage_v1(uuid,integer) from public,anon,authenticated;
grant execute on function public.fast_seal_erp_stage_v1(uuid,integer) to service_role;
commit;
