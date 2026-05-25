-- Cleanup old request-folder sales rep spellings.
-- This merges misspelled top-level Request folders into the correct sales rep name.

begin;

-- Preview active request rows that will move before running the UPDATE:
select requested_by, count(*) as row_count
from public.v2_active_request
where lower(trim(coalesce(requested_by, ''))) in (
  'alyssa',
  'ben machino',
  'chace',
  'chance',
  'chance alldredge',
  'chance alldredgr',
  'jd',
  'j d',
  'jd jones'
)
group by requested_by
order by requested_by;

update public.v2_active_request
set requested_by = case
  when lower(trim(coalesce(requested_by, ''))) = 'alyssa' then 'Alyssa Beitz'
  when lower(trim(coalesce(requested_by, ''))) = 'ben machino' then 'Ben Maschino'
  when lower(trim(coalesce(requested_by, ''))) in ('chace', 'chance', 'chance alldredge', 'chance alldredgr') then 'Chance Alldredge'
  when regexp_replace(lower(trim(coalesce(requested_by, ''))), '[^a-z0-9]+', '', 'g') in ('jd', 'jdjones') then 'JD Jones'
  else requested_by
end
where lower(trim(coalesce(requested_by, ''))) in (
  'alyssa',
  'ben machino',
  'chace',
  'chance',
  'chance alldredge',
  'chance alldredgr',
  'jd',
  'j d',
  'jd jones'
);

update public.v2_request_history
set requested_by = case
  when lower(trim(coalesce(requested_by, ''))) = 'alyssa' then 'Alyssa Beitz'
  when lower(trim(coalesce(requested_by, ''))) = 'ben machino' then 'Ben Maschino'
  when lower(trim(coalesce(requested_by, ''))) in ('chace', 'chance', 'chance alldredge', 'chance alldredgr') then 'Chance Alldredge'
  when regexp_replace(lower(trim(coalesce(requested_by, ''))), '[^a-z0-9]+', '', 'g') in ('jd', 'jdjones') then 'JD Jones'
  else requested_by
end
where lower(trim(coalesce(requested_by, ''))) in (
  'alyssa',
  'ben machino',
  'chace',
  'chance',
  'chance alldredge',
  'chance alldredgr',
  'jd',
  'j d',
  'jd jones'
);

update public.v2_request_email_threads
set sales_rep_name = case
  when lower(trim(coalesce(sales_rep_name, ''))) = 'alyssa' then 'Alyssa Beitz'
  when lower(trim(coalesce(sales_rep_name, ''))) = 'ben machino' then 'Ben Maschino'
  when lower(trim(coalesce(sales_rep_name, ''))) in ('chace', 'chance', 'chance alldredge', 'chance alldredgr') then 'Chance Alldredge'
  when regexp_replace(lower(trim(coalesce(sales_rep_name, ''))), '[^a-z0-9]+', '', 'g') in ('jd', 'jdjones') then 'JD Jones'
  else sales_rep_name
end
where lower(trim(coalesce(sales_rep_name, ''))) in (
  'alyssa',
  'ben machino',
  'chace',
  'chance',
  'chance alldredge',
  'chance alldredgr',
  'jd',
  'j d',
  'jd jones'
);

commit;
