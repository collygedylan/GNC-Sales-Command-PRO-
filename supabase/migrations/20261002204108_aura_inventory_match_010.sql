begin;
set local lock_timeout = '5s';

-- pg_trgm is already used by production search indexes; the isolated database
-- fixture installs it before this migration so both paths use the same index.
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to service_role;

create or replace function public.aura_inventory_v2_name_v1(p_value text)
returns text language sql immutable parallel safe set search_path = pg_catalog
as $$
  select btrim(regexp_replace(lower(normalize(regexp_replace(coalesce(p_value, ''), '[®™℠]', '', 'g'), NFKC)), '[^[:alnum:]]+', ' ', 'g'))
$$;

-- Inventory name lookup is isolated to the authorized name/size matcher.
-- Trigram GIN narrows fuzzy candidates; B-tree indexes support exact identity
-- and the season/size scope before name ranking.
create index if not exists idx_ph_master_inventory_aura_name_trgm
  on public.ph_master_inventory using gin (public.aura_inventory_v2_name_v1(commonname) extensions.gin_trgm_ops);
create index if not exists idx_ph_master_inventory_aura_name_exact
  on public.ph_master_inventory (public.aura_inventory_v2_name_v1(commonname));
create index if not exists idx_ph_master_inventory_aura_season_size
  on public.ph_master_inventory (upper(btrim(coalesce(season,''))), public.aura_inventory_v2_size_v1(contsize));

create or replace function public.aura_inventory_v2_match_v1(
  p_common_name text,
  p_contsize text default null,
  p_locationcode text default null,
  p_metric text default 'ptravailable',
  p_open_stock_only boolean default false,
  p_expected_season text default null
) returns jsonb
language plpgsql stable security invoker
set search_path = pg_catalog, public, extensions
set statement_timeout = '4s'
set pg_trgm.similarity_threshold = '0.12'
set pg_trgm.word_similarity_threshold = '0.3'
as $$
declare
  v_query text := public.aura_inventory_v2_name_v1(p_common_name);
  v_size text := nullif(public.aura_inventory_v2_size_v1(p_contsize), '');
  v_season text;
  v_query_season text;
  v_sales_year integer;
  v_settings jsonb;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_common_name, '')), '') is null or length(p_common_name) > 160 or v_query = '' then
    raise exception using errcode='22023', message='AURA_V2_NAME_INVALID';
  end if;
  if lower(coalesce(p_metric,'ptravailable')) not in ('ptravailable','ptronhand') then
    raise exception using errcode='22023', message='AURA_V2_METRIC_INVALID';
  end if;
  if length(coalesce(p_contsize,'')) > 48 or length(coalesce(p_locationcode,'')) > 64 then
    raise exception using errcode='22023', message='AURA_V2_FILTER_INVALID';
  end if;
  if p_expected_season is not null and upper(btrim(p_expected_season)) not in ('S1','F1','U1','U2','U3','X','Y','Z') then
    raise exception using errcode='22023', message='AURA_V2_SEASON_INVALID';
  end if;

  select s.value into v_settings from public.ph_app_settings s where s.key='current_season_salesyear';
  v_season := upper(btrim(coalesce(v_settings->>'seasonCode',v_settings->>'season_code',v_settings->>'currentSeason',v_settings->>'current_season','')));
  v_sales_year := public.aura_inventory_v2_salesyear_v1(coalesce(v_settings->>'salesYear',v_settings->>'sales_year',v_settings->>'currentSalesYear',v_settings->>'current_sales_year',v_settings->>'salesyear'));
  if v_season not in ('S1','F1','U1','U2','U3','X','Y','Z') or v_sales_year is null or v_sales_year > 99 then
    raise exception using errcode='22023', message='AURA_SETTINGS_UNAVAILABLE';
  end if;
  v_query_season := coalesce(upper(btrim(p_expected_season)), v_season);

  with scoped as (
    select m.itemcode, btrim(m.commonname) commonname, m.contsize,
      public.aura_inventory_v2_name_v1(m.commonname) normalized_name,
      upper(btrim(m.itemcode)) item_key,
      public.aura_inventory_v2_size_v1(m.contsize) size_key,
      public.aura_inventory_v2_salesyear_v1(m.saleyear) sales_year,
      public.aura_inventory_v2_number_v1(m.s_lts) open_qty,
      nullif(btrim(coalesce(m.itemcode,'')),'') is null
        or nullif(btrim(coalesce(m.commonname,'')),'') is null
        or nullif(public.aura_inventory_v2_size_v1(m.contsize),'') is null bad_identity
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.season,''))) = v_query_season
      and (v_size is null or public.aura_inventory_v2_size_v1(m.contsize) = v_size)
      and (nullif(btrim(coalesce(p_locationcode,'')),'') is null
        or upper(btrim(coalesce(m.locationcode,''))) = upper(btrim(p_locationcode)))
      and lower(btrim(coalesce(m.app_tab_assignment,''))) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
      and position('SHFT' in upper(coalesce(m.desigitem,''))) = 0
      and (public.aura_inventory_v2_salesyear_v1(m.saleyear) <= v_sales_year
        or public.aura_inventory_v2_salesyear_v1(m.saleyear) is null)
      and (not p_open_stock_only or public.aura_inventory_v2_number_v1(m.s_lts) > 0
        or public.aura_inventory_v2_number_v1(m.s_lts) is null)
  ), matched as (
    select s.*,
      case
        when s.normalized_name = v_query then 'exact'
        when not exists (
          select 1 from unnest(string_to_array(v_query, ' ')) token
          where token <> '' and position(' ' || token || ' ' in ' ' || s.normalized_name || ' ') = 0
        ) then 'keyword'
        else 'fuzzy'
      end match_kind,
      case when s.normalized_name = v_query then 1.0::real
        when not exists (
          select 1 from unnest(string_to_array(v_query, ' ')) token
          where token <> '' and position(' ' || token || ' ' in ' ' || s.normalized_name || ' ') = 0
        ) then extensions.word_similarity(v_query, s.normalized_name)
        else extensions.similarity(s.normalized_name, v_query)
      end match_score
    from scoped s
    where (s.normalized_name = v_query or s.normalized_name % v_query or s.normalized_name %> v_query)
      and nullif(s.item_key,'') is not null
      and nullif(s.normalized_name,'') is not null
      and nullif(s.size_key,'') is not null
  ), grouped as (
    select item_key, size_key, min(itemcode) itemcode,
      min(commonname) commonname, min(contsize) contsize,
      case when bool_or(match_kind='exact') then 'exact'
        when bool_or(match_kind='keyword') then 'keyword' else 'fuzzy' end match_kind,
      max(match_score) score,
      bool_or(sales_year is null or (p_open_stock_only and open_qty is null)) incomplete
    from matched
    group by item_key, size_key
  ), bounded as (
    select * from grouped order by
      case match_kind when 'exact' then 0 when 'keyword' then 1 else 2 end,
      score desc, item_key, size_key limit 6
  ), summary as (
    select coalesce((select bool_or(incomplete) from grouped),false)
      or coalesce((select bool_or(bad_identity or sales_year is null or (p_open_stock_only and open_qty is null)) from scoped),false) incomplete
  ), numbered as (
    select bounded.*, row_number() over(order by
      case match_kind when 'exact' then 0 when 'keyword' then 1 else 2 end,
      score desc, item_key, size_key) ordinal from bounded
  ), payload as (
    select coalesce((select jsonb_agg(jsonb_build_object(
      'itemcode', itemcode, 'commonname', commonname, 'contsize', contsize,
      'matchKind', match_kind, 'score', round(score::numeric, 4)
    ) order by case match_kind when 'exact' then 0 when 'keyword' then 1 else 2 end,
      score desc, item_key, size_key) from numbered where ordinal <= 5), '[]'::jsonb) rows,
      (select count(*) > 5 from numbered) additional_matches,
      summary.incomplete,
      (select count(*) filter (where match_kind='exact') from numbered) exact_count,
      (select count(*) from numbered) total_count
    from summary
  )
  select jsonb_build_object(
    'ok', true,
    'complete', not incomplete,
    'additionalMatches', additional_matches,
    'exactMatch', exact_count=1 and total_count=1 and not coalesce(incomplete,false) and not additional_matches,
    'rows', rows,
    'season', v_query_season,
    'activeSeason', v_season,
    'salesYear', v_sales_year,
    'metric', lower(coalesce(p_metric,'ptravailable'))
  ) into v_result from payload;
  return coalesce(v_result, jsonb_build_object('ok',true,'complete',true,'additionalMatches',false,'exactMatch',false,'rows','[]'::jsonb,
    'season',v_query_season,'activeSeason',v_season,'salesYear',v_sales_year,'metric',lower(coalesce(p_metric,'ptravailable'))));
end;
$$;

revoke all on function public.aura_inventory_v2_name_v1(text) from public, anon, authenticated;
revoke all on function public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.aura_inventory_v2_name_v1(text) to service_role;
grant execute on function public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text) to service_role;

commit;
