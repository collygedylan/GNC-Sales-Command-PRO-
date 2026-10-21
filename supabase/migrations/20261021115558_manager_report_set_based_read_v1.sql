begin;
-- Retain the current authorization, READY publication proof, exact revisions,
-- report membership and response contract. Normalize repeated values once and
-- resolve active ownership in one join; aggregate only the requested group page.
do $migration$
declare definition text; patch record;
begin
  definition:=pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure);
  if position('active_assignment_users as materialized' in definition)>0 then return; end if;
  for patch in select * from (values
    ($old$coalesce(nullif(private.eval_normalize_user_v2(private.inventory_effective_owner_v1(m.unique_id)),''),'') assignedto$old$,
     $new$coalesce(owner.assignedto,'') assignedto$new$,1),
    ($old$  ), source_rows as materialized (
    select m.unique_id,m.itemcode,m.commonname,m.contsize,m.locationcode,m.lotcode,m.ptronhand,$old$,
     $new$  ), active_assignment_users as materialized (
    select distinct lower(btrim(u.username)) username,trim(both '_' from lower(regexp_replace(trim(coalesce(u.username, '')), '[^a-zA-Z0-9]+', '_', 'g'))) assignedto
    from public.ph_eval_assignment_users u
    left join public.profiles p on lower(btrim(p.username))=lower(btrim(u.username))
    where u.active and (p.id is null or (p.disabled_at is null and (p.locked_until is null or p.locked_until<=now())))
  ), effective_owners as materialized (
    select a.master_unique_id,u.assignedto
    from public.ph_inventory_row_assignments a
    join active_assignment_users u on u.username=lower(btrim(a.assignedto))
    where a.present_in_drive and (select private.inventory_row_assignment_policy_active_v1())
  ), parsed_years as materialized (
    select value,private.manager_report_sales_year_v1(value) parsed from (select distinct saleyear::text value from public.ph_master_inventory) v
  ), parsed_stock as materialized (
    select value,private.manager_report_safe_numeric_v1(value) parsed from (select distinct s_lts::text value from public.ph_master_inventory) v
  ), parsed_dates as materialized (
    select value,private.manager_report_date_v1(value) parsed from (select holdstopbegindate::text value from public.ph_master_inventory union select locationnotedate::text from public.ph_master_inventory) v where nullif(btrim(value),'') is not null
  ), source_rows as materialized (
    select m.unique_id,m.itemcode,m.commonname,m.contsize,m.locationcode,m.lotcode,m.ptronhand,$new$,1),
    ($old$from public.ph_master_inventory m
    where nullif(btrim(coalesce(m.itemcode,'')),'') is not null
      and (coalesce(filters->>'itemCode','')='' or upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(filters->>'itemCode'))$old$,
     $new$from public.ph_master_inventory m
    left join effective_owners owner on owner.master_unique_id=m.unique_id
    left join parsed_years years on years.value=m.saleyear::text
    left join parsed_stock stock on stock.value=m.s_lts::text
    left join parsed_dates holds on holds.value=m.holdstopbegindate::text
    left join parsed_dates notes on notes.value=m.locationnotedate::text
    where nullif(btrim(coalesce(m.itemcode,'')),'') is not null
      and (coalesce(filters->>'itemCode','')='' or upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(filters->>'itemCode'))$new$,1),
    ($old$coalesce(private.manager_report_sales_year_v1(m.saleyear::text),0) sales_year$old$,
     $new$coalesce(years.parsed,0) sales_year$new$,1),
    ($old$private.manager_report_date_v1(m.holdstopbegindate::text) hold_day$old$,
     $new$holds.parsed hold_day$new$,1),
    ($old$private.manager_report_date_v1(m.locationnotedate::text) note_day$old$,
     $new$notes.parsed note_day$new$,1),
    ($old$coalesce(private.manager_report_safe_numeric_v1(m.s_lts::text),0) slts$old$,
     $new$coalesce(stock.parsed,0) slts$new$,1),
    ($old$and private.manager_report_progressive_search_v1(array[$old$,
     $new$and (coalesce(btrim(filters->>'search'),'')='' or private.manager_report_progressive_search_v1(array[$new$,1),
    ($old$],filters->>'search')$old$,
     $new$],filters->>'search'))$new$,1),
    ($old$  ), grouped as ($old$,
     $new$  ), group_keys as materialized (
    select case coalesce(filters->>'groupBy','itemcode')
        when 'blockalpha' then private.manager_report_block_key_v1(surface,blockalpha,locationcode)
        when 'locationcode' then coalesce(nullif(upper(btrim(locationcode)),''),'UNASSIGNED')
        when 'locationbase' then coalesce(nullif(private.manager_report_location_base_v1(locationcode),''),'UNASSIGNED')
        when 'commonname' then coalesce(nullif(btrim(commonname),''),nullif(btrim(itemcode),''),'Unknown')
        when 'contsize' then coalesce(nullif(btrim(contsize),''),'-')
        when 'row' then unique_id else item_key end group_key,min(item_key) item_key
    from filtered
    where report_ids && requested_reports or coalesce(filters->>'cardRows','false')='true' or operation='groups'
    group by 1
  ), page_keys as materialized (
    select * from group_keys order by private.eval_work_natural_sort_key_v1(group_key),group_key limit page_limit offset page_offset
  ), grouped as ($new$,1),
    ($old$    where rid=any(requested_reports) or coalesce(filters->>'cardRows','false')='true' or operation='groups'$old$,
     $new$    where case coalesce(filters->>'groupBy','itemcode')
        when 'blockalpha' then private.manager_report_block_key_v1(surface,blockalpha,locationcode)
        when 'locationcode' then coalesce(nullif(upper(btrim(locationcode)),''),'UNASSIGNED')
        when 'locationbase' then coalesce(nullif(private.manager_report_location_base_v1(locationcode),''),'UNASSIGNED')
        when 'commonname' then coalesce(nullif(btrim(commonname),''),nullif(btrim(itemcode),''),'Unknown')
        when 'contsize' then coalesce(nullif(btrim(contsize),''),'-')
        when 'row' then unique_id else item_key end in (select group_key from page_keys)
      and (rid=any(requested_reports) or coalesce(filters->>'cardRows','false')='true' or operation='groups')$new$,1),
    ($old$select * from grouped order by private.eval_work_natural_sort_key_v1(group_key),group_key limit page_limit offset page_offset$old$,
     $new$select * from grouped order by private.eval_work_natural_sort_key_v1(group_key),group_key$new$,1),
    ($old$(select count(*) from grouped)$old$,
     $new$(select count(*) from group_keys)$new$,2),
    ($old$(select count(*)>page_offset+page_limit from grouped)$old$,
     $new$(select count(*)>page_offset+page_limit from group_keys)$new$,1),
    ($old$select count(distinct g.item_key) from grouped g$old$,
     $new$select count(distinct g.item_key) from group_keys g$new$,1),
    ($old$private.manager_report_block_key_v1(surface,min(blockalpha),min(locationcode))$old$,
     $new$case when surface='eval2' then coalesce(nullif(btrim(min(blockalpha)),''),'__NO_BLOCK_ALPHA__') else private.manager_report_block_key_v1(surface,min(blockalpha),min(locationcode)) end$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(contsize)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(contsize,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(itemcode)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(itemcode,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(x)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(x,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(loc.value)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(loc.value,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(p.contsize)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(p.contsize,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(p.itemcode)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(p.itemcode,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(assignedto)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(assignedto,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(item_key)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(item_key,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(locationcode)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(locationcode,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,1),
    ($old$private.eval_work_natural_sort_key_v1(group_key)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(group_key,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,3),
    ($old$private.eval_work_natural_sort_key_v1(p.assignedto)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(p.assignedto,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,2),
    ($old$private.eval_work_natural_sort_key_v1(p.item_key)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(p.item_key,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,2),
    ($old$private.eval_work_natural_sort_key_v1(p.locationcode)$old$,
     $new$(select coalesce(string_agg(case when part[1] ~ '^[0-9]+$' then lpad(part[1],24,'0') else lower(part[1]) end,'' order by ordinal),'') from regexp_matches(coalesce(p.locationcode,''),'([0-9]+|[^0-9]+)','g') with ordinality as token(part,ordinal))$new$,2)
  ) changes(old_text,new_text,expected_count)
  loop
    if (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text)<>patch.expected_count then
      raise exception 'MANAGER_REPORT_SET_BASED_ANCHOR_INVALID: %',left(patch.old_text,100);
    end if;
    definition:=replace(definition,patch.old_text,patch.new_text);
  end loop;
  execute definition;
end
$migration$;
-- This remains callable only by the authenticated app-api service boundary.
revoke all on function public.manager_report_read_v2(jsonb) from public,anon,authenticated;
grant execute on function public.manager_report_read_v2(jsonb) to service_role;
commit;
