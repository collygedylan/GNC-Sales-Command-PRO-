alter table public.v2_dock_issue_status
add column if not exists source_match_key text;

create index if not exists idx_v2_dock_issue_status_source_match_key
on public.v2_dock_issue_status (source_match_key);

update public.v2_dock_issue_status
set source_match_key = case
  when
    trim(regexp_replace(upper(coalesce(dock_num, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(stop_number, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_customername, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_consigneename, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_salesrep, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_itemcode, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_contsize, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_locationcode, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_lotcode, '')), '[^A-Z0-9]+', ' ', 'g')) = ''
  then ''
  else concat_ws(
    '||',
    trim(regexp_replace(regexp_replace(upper(coalesce(dock_num, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(stop_number, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_customername, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_consigneename, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_salesrep, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_itemcode, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_contsize, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_locationcode, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_lotcode, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
  )
end
where coalesce(source_match_key, '') = '';
