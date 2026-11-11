revoke all on function public.unlock_drive_evidence_v1(text,text) from public,anon;
grant execute on function public.unlock_drive_evidence_v1(text,text) to authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$declare result jsonb; begin
  result:=public.unlock_drive_evidence_v1('exact-row','2000-01-01T00:00:00Z');
  assert result->>'ok'='true';
  assert result->'row'->>'unique_id'='exact-row';
  assert result->'row'->>'date_completed' is null;
  assert result->'row'->>'photo_link'='retained-photo';
  assert result->'row'->>'spec'='retained-spec';
  assert not exists(select from public.ph_location_sales_notes where completed_at is not null);
end$$;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$begin assert public.unlock_drive_evidence_v1('exact-row','') ->>'ok'='true'; end$$;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$begin
  perform public.unlock_drive_evidence_v1('exact-row','');
  raise exception 'FOREIGN_UNLOCK_WAS_ALLOWED';
exception when insufficient_privilege then null; end$$;
select set_config('request.jwt.claim.sub','',false);
do $$begin
  perform public.unlock_drive_evidence_v1('exact-row','');
  raise exception 'ANONYMOUS_UNLOCK_WAS_ALLOWED';
exception when insufficient_privilege then null; end$$;
do $$begin
  assert not has_function_privilege('anon','public.unlock_drive_evidence_v1(text,text)','execute');
  assert exists(select from pg_proc where oid='public.unlock_drive_evidence_v1(text,text)'::regprocedure
    and proconfig @> array['lock_timeout=8s','statement_timeout=12s']);
  assert to_regclass('public.ph_request_history_batch_v3072') is not null;
end$$;
