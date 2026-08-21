-- Historical Report should open like Drive Mode: browse immediately, then filter as the user types.
-- Keep the existing manager authorization check and invoker security model intact.
create or replace function public.search_historical_inventory_common_names(
  search_text text,
  result_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_search text := lower(btrim(coalesce(search_text, '')));
  safe_limit integer := least(greatest(coalesce(result_limit, 100), 1), 100);
  result_rows jsonb;
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'HISTORICAL_REPORT_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(to_jsonb(matches) order by matches.match_rank, matches.commonname), '[]'::jsonb)
  into result_rows
  from (
    select
      max(d.commonname) as commonname,
      count(distinct d.contsize_key)::integer as contsize_count,
      sum(d.historical_row_count)::bigint as historical_row_count,
      min(d.first_report_date) as first_report_date,
      max(d.last_report_date) as last_report_date,
      case
        when safe_search = '' then 0
        when d.commonname_key like safe_search || '%' then 0
        else 1
      end as match_rank
    from public.ph_historical_inventory_dimensions d
    where safe_search = '' or strpos(d.commonname_key, safe_search) > 0
    group by d.commonname_key
    order by match_rank, max(d.commonname)
    limit safe_limit
  ) matches;

  return result_rows;
end;
$$;

revoke all on function public.search_historical_inventory_common_names(text, integer) from public, anon;
grant execute on function public.search_historical_inventory_common_names(text, integer) to authenticated;
