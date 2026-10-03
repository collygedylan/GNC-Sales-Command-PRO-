begin;
set local lock_timeout = '5s';

-- A single project-wide ledger coordinates all Edge instances. It never stores
-- prompts, transcripts, customer identities, or provider response bodies.
create schema if not exists aura_private;
revoke all on schema aura_private from public, anon, authenticated;
grant usage on schema aura_private to service_role;
create table if not exists aura_private.llm_provider_calls (
  request_id uuid not null,
  round smallint not null check (round between 1 and 2),
  created_at timestamptz not null default clock_timestamp(),
  input_tokens integer not null check (input_tokens between 1 and 100000),
  primary key (request_id, round)
);
create index if not exists llm_provider_calls_created_at_idx
  on aura_private.llm_provider_calls(created_at);
alter table aura_private.llm_provider_calls enable row level security;
revoke all on aura_private.llm_provider_calls from public, anon, authenticated;
grant select, insert, delete on aura_private.llm_provider_calls to service_role;

create or replace function public.aura_llm_reserve_call_v1(
  p_request_id uuid, p_round integer, p_input_tokens integer,
  p_rpm integer, p_tpm integer, p_rpd integer
) returns jsonb language plpgsql volatile security invoker
set search_path = pg_catalog, aura_private
set statement_timeout = '1s'
set lock_timeout = '1s'
as $$
declare
  v_now timestamptz;
  v_day timestamptz;
  v_next_day timestamptz;
  v_count integer;
  v_tokens bigint;
  v_first timestamptz;
  v_daily integer;
begin
  if p_request_id is null or p_round is null or p_round not between 1 and 2
    or p_input_tokens is null or p_input_tokens not between 1 and 100000
    or p_rpm is null or p_rpm not between 1 and 15
    or p_tpm is null or p_tpm not between 1 and 1000000
    or p_rpd is null or p_rpd not between 1 and 100000 then
    raise exception using errcode='22023', message='AURA_LLM_QUOTA_INVALID';
  end if;
  -- Acquired before reading the clock: waiting for another instance cannot
  -- reserve against an expired window. One lock covers all sessions/models.
  perform pg_advisory_xact_lock(110011011);
  v_now := clock_timestamp();
  v_day := ((v_now at time zone 'America/Los_Angeles')::date)::timestamp at time zone 'America/Los_Angeles';
  v_next_day := ((v_now at time zone 'America/Los_Angeles')::date + 1)::timestamp at time zone 'America/Los_Angeles';
  delete from aura_private.llm_provider_calls where created_at < v_now - interval '2 days';
  if exists(select 1 from aura_private.llm_provider_calls where request_id=p_request_id and round=p_round) then
    return jsonb_build_object('allowed',false,'duplicate',true,'reason','duplicate','retryAfter',0);
  end if;
  select count(*), coalesce(sum(input_tokens),0), min(created_at)
    into v_count,v_tokens,v_first from aura_private.llm_provider_calls
    where created_at > v_now - interval '60 seconds';
  if p_input_tokens > p_tpm then
    return jsonb_build_object('allowed',false,'duplicate',false,'reason','input_limit','retryAfter',0);
  end if;
  if v_count >= p_rpm or v_tokens + p_input_tokens > p_tpm then
    return jsonb_build_object('allowed',false,'duplicate',false,
      'reason',case when v_count>=p_rpm then 'rpm' else 'tpm' end,
      'retryAfter',greatest(1,ceil(extract(epoch from (v_first+interval '60 seconds'-v_now)))::integer));
  end if;
  select count(*) into v_daily from aura_private.llm_provider_calls where created_at >= v_day;
  if v_daily >= p_rpd then
    return jsonb_build_object('allowed',false,'duplicate',false,'reason','rpd',
      'retryAfter',greatest(1,ceil(extract(epoch from (v_next_day-v_now)))::integer));
  end if;
  insert into aura_private.llm_provider_calls(request_id,round,created_at,input_tokens)
    values(p_request_id,p_round,v_now,p_input_tokens);
  return jsonb_build_object('allowed',true,'duplicate',false,'reason',null,'retryAfter',0);
end;
$$;

-- A lot code is shared by many SKU/location rows; return a keyset page and
-- never turn that page into an asserted inventory total.
create index if not exists idx_ph_master_inventory_aura_lot_uid
  on public.ph_master_inventory(upper(btrim(coalesce(lotcode,''))), unique_id);
create or replace function public.aura_inventory_lot_lookup_v1(
  p_lotcode text, p_after_uid text default null, p_limit integer default 100
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public
set statement_timeout = '4s'
as $$
declare
  v_code text := upper(btrim(coalesce(p_lotcode,'')));
  v_setting jsonb;
  v_year integer;
  v_season text;
  v_result jsonb;
begin
  if v_code='' or length(v_code)>64 or v_code !~ '^[A-Z0-9][A-Z0-9._-]*$'
    or length(coalesce(p_after_uid,''))>256 or p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode='22023',message='AURA_LOT_FILTER_INVALID';
  end if;
  select value into v_setting from public.ph_app_settings where key='current_season_salesyear';
  v_year := public.aura_inventory_v2_salesyear_v1(coalesce(v_setting->>'salesYear',v_setting->>'sales_year',v_setting->>'currentSalesYear',v_setting->>'current_sales_year',v_setting->>'salesyear'));
  v_season := upper(btrim(coalesce(v_setting->>'seasonCode',v_setting->>'season_code',v_setting->>'currentSeason',v_setting->>'current_season','')));
  if v_year is null or v_year>99 or v_season not in ('S1','F1','U1','U2','U3','X','Y','Z') then
    raise exception using errcode='22023',message='AURA_SETTINGS_UNAVAILABLE';
  end if;
  with eligible as (
    select m.unique_id,m.itemcode,m.commonname,m.contsize,m.locationcode,m.lotcode,m.season,m.saleyear,
      public.aura_inventory_v2_number_v1(m.ptravailable) ptravailable,
      public.aura_inventory_v2_number_v1(m.ptronhand) ptronhand,
      public.aura_inventory_v2_number_v1(m.s_lts) s_lts,
      public.aura_inventory_v2_number_v1(m.priority) priority,
      public.aura_inventory_v2_salesyear_v1(m.saleyear) sales_year
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.lotcode,'')))=v_code
      and lower(btrim(coalesce(m.app_tab_assignment,''))) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
      and position('SHFT' in upper(coalesce(m.desigitem,'')))=0
      and upper(btrim(coalesce(m.season,''))) in ('S1','F1','U1','U2','U3','X','Y','Z')
      and (public.aura_inventory_v2_salesyear_v1(m.saleyear)<=v_year or public.aura_inventory_v2_salesyear_v1(m.saleyear) is null)
  ), bounded as (
    select * from eligible where (p_after_uid is null or unique_id>p_after_uid)
    order by unique_id limit p_limit+1
  ), page as (
    select * from bounded order by unique_id limit p_limit
  )
  select jsonb_build_object('ok',true,'lotcode',v_code,'salesYear',v_year,'activeSeason',v_season,
    'complete',not coalesce((select bool_or(sales_year is null or ptravailable is null or ptronhand is null
      or nullif(btrim(itemcode),'') is null or nullif(btrim(commonname),'') is null
      or nullif(btrim(contsize),'') is null or nullif(btrim(unique_id),'') is null) from eligible),false),
    'rows',coalesce((select jsonb_agg(to_jsonb(page)-'sales_year' order by unique_id) from page),'[]'::jsonb),
    'hasMore',(select count(*)>p_limit from bounded),
    'nextCursor',case when (select count(*)>p_limit from bounded) then (select max(unique_id) from page) else null end
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.aura_inventory_lot_lookup_v1(text,text,integer) from public,anon,authenticated;
grant execute on function public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer) to service_role;
grant execute on function public.aura_inventory_lot_lookup_v1(text,text,integer) to service_role;
commit;
