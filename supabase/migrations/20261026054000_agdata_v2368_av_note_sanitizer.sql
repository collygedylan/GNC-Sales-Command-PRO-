begin;

create or replace function public.sanitize_av_note_without_spec_caliper(p_raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  with parts as (
    select btrim(segment) segment,ordinal
    from regexp_split_to_table(
      regexp_replace(coalesce(p_raw,''),$regex$\mN[[:space:]]*/[[:space:]]*A\M$regex$,'','gi'),
      $regex$[[:space:]]*/[[:space:]]*$regex$
    ) with ordinality as split(segment,ordinal)
  ), cleaned as (
    select ordinal,
      case
        when segment ~* $regex$(^|[^a-z])(spec|caliper|cal)([^a-z]|$)$regex$ then null
        else nullif(btrim(regexp_replace(
          segment,
          $regex$^[[:space:]]*[0-9]+([.][0-9]+)?([[:space:]]*-[[:space:]]*[0-9]+([.][0-9]+)?)?[[:space:]]*(in(ch(es)?)?|['"])?[[:space:]]*(h[[:space:]]*x[[:space:]]*w|height|high|h|width|wide|w|tall|t|caliper|cal)([[:space:]]*(x|-|by)[[:space:]]*[0-9]+([.][0-9]+)?([[:space:]]*-[[:space:]]*[0-9]+([.][0-9]+)?)?[[:space:]]*(in(ch(es)?)?|['"])?[[:space:]]*(height|high|h|width|wide|w|tall|t)?)?[[:space:]]*[-,:;]*[[:space:]]*$regex$,
          '',
          'i'
        )), '')
      end clean_segment
    from parts
    where nullif(segment,'') is not null
  )
  select nullif(string_agg(clean_segment,' / ' order by ordinal),'')
  from cleaned
  where clean_segment is not null
    and clean_segment !~* $regex$^[[:space:]]*[0-9]+([.][0-9]+)?([[:space:]]*-[[:space:]]*[0-9]+([.][0-9]+)?)?[[:space:]]*(in(ch(es)?)?|['"])?([[:space:]]*(h[[:space:]]*x[[:space:]]*w|height|high|h|width|wide|w|tall|t|caliper|cal))?([[:space:]]*(x|-|by)[[:space:]]*[0-9]+([.][0-9]+)?([[:space:]]*-[[:space:]]*[0-9]+([.][0-9]+)?)?[[:space:]]*(in(ch(es)?)?|['"])?[[:space:]]*(height|high|h|width|wide|w|tall|t)?)?[[:space:]]*$$regex$
$function$;

revoke all on function public.sanitize_av_note_without_spec_caliper(text) from public,anon;
grant execute on function public.sanitize_av_note_without_spec_caliper(text) to authenticated,service_role;

commit;
